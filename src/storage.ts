import {constants} from 'node:fs';
import {access, chmod, copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createStore, type Store, storeSchema} from './domain.js';

export class CorruptStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CorruptStoreError';
  }
}

type RepositoryOptions = {
  retryMs?: number;
  lockTimeoutMs?: number;
  staleLockMs?: number;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class StoreRepository {
  readonly storePath: string;
  readonly backupPath: string;
  readonly lockPath: string;
  private readonly retryMs: number;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  constructor(storePath: string, options: RepositoryOptions = {}) {
    this.storePath = storePath;
    this.backupPath = `${storePath}.bak`;
    this.lockPath = `${storePath}.lock`;
    this.retryMs = options.retryMs ?? 25;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
  }

  async load(): Promise<Store> {
    await this.preparePrivatePaths();
    try {
      return await this.readAndValidate(this.storePath);
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
      const initial = createStore();
      try {
        const handle = await open(this.storePath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(initial, null, 2)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        return initial;
      } catch (createError) {
        if (!isNodeError(createError, 'EEXIST')) throw createError;
        return this.readAndValidate(this.storePath);
      }
    }
  }

  async mutate(operation: (store: Store) => Store | Promise<Store>): Promise<Store> {
    await this.preparePrivatePaths();
    await this.acquireLock();
    try {
      const current = await this.load();
      const candidate = await operation(structuredClone(current));
      const next = storeSchema.parse({...candidate, schemaVersion: 1, revision: current.revision + 1});
      await copyFile(this.storePath, this.backupPath);
      await this.hardenFile(this.backupPath);
      await this.atomicWrite(next);
      return next;
    } finally {
      await unlink(this.lockPath).catch(error => {
        if (!isNodeError(error, 'ENOENT')) throw error;
      });
    }
  }

  async restoreBackup(): Promise<Store> {
    await this.preparePrivatePaths();
    await this.acquireLock();
    try {
      const backup = await this.readAndValidate(this.backupPath);
      let current: Store | null = null;
      try {
        current = await this.readAndValidate(this.storePath);
      } catch (error) {
        if (!(error instanceof CorruptStoreError)) throw error;
      }
      const restored = storeSchema.parse({...backup, revision: (current?.revision ?? backup.revision) + 1});
      if (current) {
        await copyFile(this.storePath, this.backupPath);
        await this.hardenFile(this.backupPath);
      }
      await this.atomicWrite(restored);
      return restored;
    } finally {
      await unlink(this.lockPath).catch(() => undefined);
    }
  }

  async doctor(): Promise<{ok: boolean; revision?: number; backupValid: boolean; error?: string}> {
    let backupValid = false;
    try {
      await this.readAndValidate(this.backupPath);
      backupValid = true;
    } catch {
      // A missing backup is normal before the first mutation.
    }
    try {
      const store = await this.load();
      return {ok: true, revision: store.revision, backupValid};
    } catch (error) {
      return {ok: false, backupValid, error: error instanceof Error ? error.message : String(error)};
    }
  }

  private async readAndValidate(path: string): Promise<Store> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) throw error;
      throw new CorruptStoreError(`Store at ${path} is not valid JSON`, {cause: error});
    }
    if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
      const version = (parsed as {schemaVersion?: unknown}).schemaVersion;
      if (typeof version === 'number' && version > 1) {
        throw new CorruptStoreError('Store was created by a newer version of todo-dashboard');
      }
    }
    const result = storeSchema.safeParse(parsed);
    if (!result.success) throw new CorruptStoreError(`Store at ${path} failed validation: ${result.error.message}`);
    return result.data;
  }

  private async atomicWrite(store: Store): Promise<void> {
    const temporary = `${this.storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {encoding: 'utf8', flag: 'wx', mode: 0o600});
    await rename(temporary, this.storePath);
  }

  private async acquireLock(): Promise<void> {
    const started = Date.now();
    while (true) {
      try {
        const handle = await open(this.lockPath, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify({pid: process.pid, createdAt: new Date().toISOString()}));
        } finally {
          await handle.close();
        }
        return;
      } catch (error) {
        if (!isNodeError(error, 'EEXIST')) throw error;
        if (await this.lockIsStale()) {
          await unlink(this.lockPath).catch(unlinkError => {
            if (!isNodeError(unlinkError, 'ENOENT')) throw unlinkError;
          });
          continue;
        }
        if (Date.now() - started >= this.lockTimeoutMs) throw new Error(`Timed out waiting for store lock at ${this.lockPath}`);
        await sleep(this.retryMs);
      }
    }
  }

  private async lockIsStale(): Promise<boolean> {
    try {
      const info = await stat(this.lockPath);
      if (Date.now() - info.mtimeMs > this.staleLockMs) return true;
      const lock = JSON.parse(await readFile(this.lockPath, 'utf8')) as {pid?: number};
      if (typeof lock.pid !== 'number') return false;
      try {
        process.kill(lock.pid, 0);
        return false;
      } catch (error) {
        return isNodeError(error, 'ESRCH');
      }
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return false;
      return false;
    }
  }

  private async preparePrivatePaths(): Promise<void> {
    const directory = dirname(this.storePath);
    await mkdir(directory, {recursive: true, mode: 0o700});
    if (process.platform === 'win32') return;
    await chmod(directory, 0o700);
    await this.hardenFile(this.storePath);
    await this.hardenFile(this.backupPath);
  }

  private async hardenFile(path: string): Promise<void> {
    if (process.platform === 'win32') return;
    await chmod(path, 0o600).catch(error => {
      if (!isNodeError(error, 'ENOENT')) throw error;
    });
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

export async function storeExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
