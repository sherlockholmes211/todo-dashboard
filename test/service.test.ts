import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {TodoService} from '../src/service.js';
import {StoreRepository} from '../src/storage.js';

let directory: string;
let current: Date;
let service: TodoService;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'todo-service-test-'));
  current = new Date('2026-09-20T10:00:00.000Z');
  service = new TodoService(new StoreRepository(join(directory, 'store.json')), () => current);
});

afterEach(async () => rm(directory, {recursive: true, force: true}));

describe('TodoService', () => {
  it('creates, edits, lists, shows, and deletes tasks by unique ID prefix', async () => {
    const created = await service.add('Write docs', {estimate: '2h', due: 'tomorrow 6pm'});
    expect(created.title).toBe('Write docs');
    expect((await service.show(created.id.slice(0, 8))).id).toBe(created.id);
    const edited = await service.edit(created.id.slice(0, 8), {title: 'Ship docs', remaining: '45m'});
    expect(edited.title).toBe('Ship docs');
    expect(edited.estimateMs).toBe(2_700_000);
    expect((await service.list()).map(task => task.title)).toEqual(['Ship docs']);
    await service.delete(created.id.slice(0, 8));
    expect(await service.list({all: true})).toEqual([]);
  });

  it('requires ID prefixes to match exactly one task', async () => {
    await service.add('A', {}, 'abc00000-0000-4000-8000-000000000000');
    await service.add('B', {}, 'abc11111-0000-4000-8000-000000000000');
    await expect(service.show('abc')).rejects.toThrow(/ambiguous/i);
    await expect(service.show('missing')).rejects.toThrow(/not found/i);
  });

  it('starts timers independently and pauses all in one revision', async () => {
    const a = await service.add('A');
    const b = await service.add('B');
    await service.start(a.id);
    await service.start(b.id);
    current = new Date('2026-09-20T10:10:00.000Z');
    const paused = await service.pauseAll();
    expect(paused.map(task => task.trackedMs)).toEqual([600_000, 600_000]);
    expect((await service.getStore()).revision).toBe(5);
  });

  it('hides completed tasks by default and supports reopen', async () => {
    const task = await service.add('A');
    await service.done(task.id);
    expect(await service.list()).toEqual([]);
    expect(await service.list({all: true})).toHaveLength(1);
    await service.reopen(task.id);
    expect(await service.list()).toHaveLength(1);
  });

  it('validates and persists configuration values', async () => {
    await service.setConfig('progressBarWidth', '30');
    await service.setConfig('showCompleted', 'true');
    expect(await service.getConfig('progressBarWidth')).toBe(30);
    expect(await service.getConfig('showCompleted')).toBe(true);
    await expect(service.setConfig('progressBarWidth', '2')).rejects.toThrow();
    await expect(service.getConfig('missing')).rejects.toThrow(/unknown/i);
  });
});
