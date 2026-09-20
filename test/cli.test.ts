import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {executeCli, selectInterface} from '../src/cli.js';
import {TodoService} from '../src/service.js';
import {StoreRepository} from '../src/storage.js';

let directory: string;
let service: TodoService;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'todo-cli-test-'));
  service = new TodoService(new StoreRepository(join(directory, 'store.json')), () => new Date('2026-09-20T10:00:00.000Z'));
});

afterEach(async () => rm(directory, {recursive: true, force: true}));

async function run(args: string[], tty = false, confirmation = true) {
  let stdout = '';
  let stderr = '';
  const code = await executeCli(args, {
    service,
    stdout: value => { stdout += value; },
    stderr: value => { stderr += value; },
    isTTY: tty,
    confirm: async () => confirmation
  });
  return {code, stdout, stderr};
}

describe('CLI', () => {
  it('prints stable JSON for add, list, and show', async () => {
    const added = await run(['add', 'Build release', '--estimate', '2h', '--json']);
    expect(added.code).toBe(0);
    const task = JSON.parse(added.stdout);
    expect(task).toMatchObject({title: 'Build release', estimateMs: 7_200_000});
    const listed = await run(['list', '--json']);
    expect(JSON.parse(listed.stdout)[0].id).toBe(task.id);
    const shown = await run(['show', task.id.slice(0, 8), '--json']);
    expect(JSON.parse(shown.stdout).title).toBe('Build release');
  });

  it('sends validation errors to stderr with a nonzero code', async () => {
    const result = await run(['add', ' ', '--estimate', 'nonsense']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/positive duration/i);
  });

  it('requires force for noninteractive deletion and confirmation interactively', async () => {
    const task = await service.add('Protected');
    expect((await run(['delete', task.id])).code).toBe(1);
    expect((await run(['delete', task.id, '--force'])).code).toBe(0);
    const second = await service.add('Ask first');
    expect((await run(['delete', second.id], true, false)).code).toBe(1);
    expect((await service.show(second.id)).title).toBe('Ask first');
  });

  it('supports timer, edit, config, and doctor commands', async () => {
    const task = await service.add('A');
    expect((await run(['start', task.id])).code).toBe(0);
    expect((await run(['pause', '--all'])).code).toBe(0);
    expect((await run(['edit', task.id, '--title', 'B', '--remaining', '30m'])).code).toBe(0);
    expect((await run(['config', 'set', 'clock', '12h'])).code).toBe(0);
    expect((await run(['config', 'get', 'clock'])).stdout.trim()).toBe('12h');
    expect((await run(['doctor'])).stdout).toMatch(/healthy/i);
  });

  it('selects TUI only when no command and both streams are terminals', () => {
    expect(selectInterface([], true, true)).toBe('tui');
    expect(selectInterface([], true, false)).toBe('static');
    expect(selectInterface(['list'], true, true)).toBe('cli');
  });
});
