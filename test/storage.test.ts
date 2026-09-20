import {chmod, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createStore, createTask} from '../src/domain.js';
import {CorruptStoreError, StoreRepository} from '../src/storage.js';

const directories: string[] = [];

async function tempStore() {
  const directory = await mkdtemp(join(tmpdir(), 'todo-dashboard-test-'));
  directories.push(directory);
  return {directory, path: join(directory, 'store.json')};
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, {recursive: true, force: true})));
});

describe('StoreRepository', () => {
  it('initializes a valid empty store on first load', async () => {
    const location = await tempStore();
    const repository = new StoreRepository(location.path);
    const store = await repository.load();
    expect(store).toMatchObject({schemaVersion: 1, revision: 0, tasks: []});
    expect(JSON.parse(await readFile(location.path, 'utf8'))).toEqual(store);
  });

  it('increments once, atomically retains the previous revision, and removes its lock', async () => {
    const location = await tempStore();
    const repository = new StoreRepository(location.path);
    await repository.load();
    const changed = await repository.mutate(store => ({...store, tasks: [createTask({title: 'One'})]}));
    expect(changed.revision).toBe(1);
    expect(JSON.parse(await readFile(`${location.path}.bak`, 'utf8')).revision).toBe(0);
    await expect(stat(`${location.path}.lock`)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it.skipIf(process.platform === 'win32')('creates its directory, store, lock, and backup with private permissions', async () => {
    const location = await tempStore();
    const storePath = join(location.directory, 'private', 'store.json');
    const repository = new StoreRepository(storePath);
    await repository.load();
    let lockMode = 0;
    await repository.mutate(async store => {
      lockMode = (await stat(`${storePath}.lock`)).mode & 0o777;
      return store;
    });
    expect((await stat(join(location.directory, 'private'))).mode & 0o777).toBe(0o700);
    expect((await stat(storePath)).mode & 0o777).toBe(0o600);
    expect((await stat(`${storePath}.bak`)).mode & 0o777).toBe(0o600);
    expect(lockMode).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')('tightens permissions on an existing store and backup', async () => {
    const location = await tempStore();
    await writeFile(location.path, `${JSON.stringify(createStore())}\n`);
    await writeFile(`${location.path}.bak`, `${JSON.stringify(createStore())}\n`);
    await chmod(location.path, 0o644);
    await chmod(`${location.path}.bak`, 0o644);
    const repository = new StoreRepository(location.path);
    await repository.load();
    expect((await stat(location.path)).mode & 0o777).toBe(0o600);
    expect((await stat(`${location.path}.bak`)).mode & 0o777).toBe(0o600);
  });

  it('serializes concurrent mutations without losing either change', async () => {
    const location = await tempStore();
    const first = new StoreRepository(location.path, {retryMs: 2});
    const second = new StoreRepository(location.path, {retryMs: 2});
    await first.load();
    await Promise.all([
      first.mutate(store => ({...store, tasks: [...store.tasks, createTask({title: 'A'})]})),
      second.mutate(store => ({...store, tasks: [...store.tasks, createTask({title: 'B'})]}))
    ]);
    const final = await first.load();
    expect(final.revision).toBe(2);
    expect(final.tasks.map(task => task.title).sort()).toEqual(['A', 'B']);
    expect(JSON.parse(await readFile(`${location.path}.bak`, 'utf8')).revision).toBe(1);
  });

  it('recovers a stale lock', async () => {
    const location = await tempStore();
    const repository = new StoreRepository(location.path, {staleLockMs: 100, retryMs: 2});
    await repository.load();
    await writeFile(`${location.path}.lock`, JSON.stringify({pid: 999_999, createdAt: '2000-01-01T00:00:00.000Z'}));
    const result = await repository.mutate(store => store);
    expect(result.revision).toBe(1);
  });

  it('reports corruption without replacing invalid data', async () => {
    const location = await tempStore();
    await writeFile(location.path, '{not json');
    const repository = new StoreRepository(location.path);
    await expect(repository.load()).rejects.toBeInstanceOf(CorruptStoreError);
    expect(await readFile(location.path, 'utf8')).toBe('{not json');
  });

  it('restores an explicitly requested valid backup', async () => {
    const location = await tempStore();
    const repository = new StoreRepository(location.path);
    await repository.load();
    await repository.mutate(store => ({...store, tasks: [createTask({title: 'Saved'})]}));
    await repository.mutate(store => ({...store, tasks: []}));
    const restored = await repository.restoreBackup();
    expect(restored.tasks[0]?.title).toBe('Saved');
    expect(restored.revision).toBe(3);
  });

  it('can restore a valid backup when the current store is corrupt', async () => {
    const location = await tempStore();
    const repository = new StoreRepository(location.path);
    await repository.load();
    await repository.mutate(store => ({...store, tasks: [createTask({title: 'Recover me'})]}));
    await writeFile(location.path, '{broken');
    const restored = await repository.restoreBackup();
    expect(restored).toMatchObject({revision: 1, tasks: []});
    expect((await repository.load()).revision).toBe(1);
  });

  it('rejects a future schema version through the migration entrypoint', async () => {
    const location = await tempStore();
    await writeFile(location.path, JSON.stringify({schemaVersion: 2, revision: 0, settings: {}, tasks: []}));
    const repository = new StoreRepository(location.path);
    await expect(repository.load()).rejects.toThrow(/newer version/i);
  });
});
