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

  it.each(['lavender-dusk', 'sage-cream', 'misty-blue', 'rose-slate', 'soft-amber', 'quiet-monochrome'])('saves the %s dashboard theme', async theme => {
    await service.setConfig('colorTheme', theme);
    expect(await service.getConfig('colorTheme')).toBe(theme);
    const reopened = new TodoService(new StoreRepository(join(directory, 'store.json')));
    expect(await reopened.getConfig('colorTheme')).toBe(theme);
  });

  it('rejects an unknown dashboard theme', async () => {
    await expect(service.setConfig('colorTheme', 'neon-rainbow')).rejects.toThrow();
  });

  it('persists dashboard colors and a comma-separated visible column list', async () => {
    await service.setConfig('borderColor', '#123456');
    await service.setConfig('titleColor', '#abcdef');
    await service.setConfig('priorityColors', '{"high":"#112233"}');
    await service.setConfig('healthColors', '{"OVERDUE":"#445566"}');
    await service.setConfig('visibleColumns', 'task,dueIn,priority');
    expect(await service.getConfig('borderColor')).toBe('#123456');
    expect(await service.getConfig('titleColor')).toBe('#abcdef');
    expect(await service.getConfig('priorityColors')).toMatchObject({high: '#112233'});
    expect(await service.getConfig('healthColors')).toMatchObject({OVERDUE: '#445566', DONE: 'green'});
    expect(await service.getConfig('visibleColumns')).toEqual(['task', 'dueIn', 'priority']);
    await service.setConfig('borderColor', 'default');
    expect(await service.getConfig('borderColor')).toBeNull();
    await expect(service.setConfig('borderColor', 'not-a-color')).rejects.toThrow();
    await expect(service.setConfig('visibleColumns', 'task,unknown')).rejects.toThrow();
    await expect(service.setConfig('visibleColumns', '')).rejects.toThrow();
  });
});
