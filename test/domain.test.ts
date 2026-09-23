import {describe, expect, it} from 'vitest';
import {
  completeTask,
  createTask,
  effectiveTrackedMs,
  getMetrics,
  parseDeadline,
  parseDuration,
  pauseTask,
  reopenTask,
  sortTasks,
  startTask,
  updateTask,
  taskSchema
} from '../src/domain.js';

const at = (iso: string) => new Date(iso);

describe('duration parsing', () => {
  it.each([
    ['45m', 2_700_000],
    ['2h', 7_200_000],
    ['1h 30m', 5_400_000],
    ['2d 5s', 172_805_000]
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '0m', '-2h', 'hello', '1h leftover'])('rejects invalid duration %j', input => {
    expect(() => parseDuration(input)).toThrow(/positive duration/i);
  });
});

describe('deadline parsing', () => {
  it('applies the configured local time to a date-only deadline', () => {
    const result = parseDeadline('2026-09-25', at('2026-09-20T08:00:00Z'), '23:59');
    const parsed = new Date(result);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(8);
    expect(parsed.getDate()).toBe(25);
    expect(parsed.getHours()).toBe(23);
    expect(parsed.getMinutes()).toBe(59);
  });

  it('parses natural language relative to the injected clock', () => {
    const result = new Date(parseDeadline('tomorrow 6pm', at('2026-09-20T08:00:00Z'), '23:59'));
    expect(result.getDate()).toBe(21);
    expect(result.getHours()).toBe(18);
  });

  it('rejects an unresolvable deadline', () => {
    expect(() => parseDeadline('definitely-not-a-date', at('2026-09-20T08:00:00Z'), '23:59')).toThrow(/deadline/i);
  });
});

describe('task lifecycle and calculations', () => {
  const now = at('2026-09-20T10:00:00.000Z');

  it('defaults old and new tasks to medium priority and validates edits', () => {
    const task = createTask({title: 'A'}, now);
    expect(task.priority).toBe('medium');
    const legacy = {...task} as Partial<typeof task>;
    delete legacy.priority;
    expect(taskSchema.parse(legacy).priority).toBe('medium');
    expect(updateTask(task, {priority: 'urgent'}, now).priority).toBe('urgent');
    expect(() => taskSchema.parse({...task, priority: 'critical'})).toThrow();
  });

  it('loads tasks saved before descriptions existed', () => {
    const task = createTask({title: 'A'}, now);
    const legacy = {...task} as Partial<typeof task>;
    delete legacy.description;
    expect(taskSchema.parse(legacy).description).toBe('');
  });

  it('requires a nonblank title no longer than 200 characters', () => {
    expect(() => createTask({title: '   '}, now)).toThrow(/title/i);
    expect(() => createTask({title: 'x'.repeat(201)}, now)).toThrow(/200/i);
  });

  it.each([
    ['newline', 'safe\nforged'],
    ['tab', 'safe\tforged'],
    ['escape', `safe${String.fromCharCode(27)}[31mforged`],
    ['bell', `safe${String.fromCharCode(7)}forged`],
    ['C1 control', `safe${String.fromCharCode(155)}forged`]
  ])('rejects %s control characters in titles', (_name, title) => {
    expect(() => createTask({title}, now)).toThrow(/control character/i);
  });

  it('tracks simultaneous tasks independently', () => {
    const a = startTask(createTask({title: 'A'}, now), now);
    const b = startTask(createTask({title: 'B'}, now), at('2026-09-20T10:05:00.000Z'));
    const later = at('2026-09-20T10:15:00.000Z');
    expect(effectiveTrackedMs(a, later)).toBe(900_000);
    expect(effectiveTrackedMs(b, later)).toBe(600_000);
  });

  it('rejects invalid start and pause transitions', () => {
    const pending = createTask({title: 'A'}, now);
    expect(() => pauseTask(pending, now)).toThrow(/not running/i);
    const running = startTask(pending, now);
    expect(() => startTask(running, now)).toThrow(/already running/i);
    expect(() => startTask({...pending, status: 'completed'}, now)).toThrow(/completed/i);
  });

  it('records a running session when pausing', () => {
    const running = startTask(createTask({title: 'A'}, now), now);
    const paused = pauseTask(running, at('2026-09-20T10:12:00.000Z'));
    expect(paused.trackedMs).toBe(720_000);
    expect(paused.activeSince).toBeNull();
    expect(paused.status).toBe('pending');
  });

  it('completes a running task and reopens it without losing tracked time', () => {
    const running = startTask(createTask({title: 'A'}, now), now);
    const completed = completeTask(running, at('2026-09-20T10:12:00.000Z'));
    expect(completed.trackedMs).toBe(720_000);
    expect(completed.completedAt).toBe('2026-09-20T10:12:00.000Z');
    const reopened = reopenTask(completed, at('2026-09-20T11:00:00.000Z'));
    expect(reopened.status).toBe('pending');
    expect(reopened.trackedMs).toBe(720_000);
    expect(reopened.completedAt).toBeNull();
  });

  it('sets a remaining-time estimate relative to effective tracked time', () => {
    const running = startTask(createTask({title: 'A', estimateMs: 3_600_000}, now), now);
    const edited = updateTask(running, {remainingMs: 1_800_000}, at('2026-09-20T10:10:00.000Z'));
    expect(edited.estimateMs).toBe(2_400_000);
  });

  it('calculates progress, work left, overruns, and health boundaries', () => {
    const base = createTask({
      title: 'A',
      estimateMs: 4_000,
      deadlineAt: '2026-09-20T10:00:04.000Z'
    }, now);
    expect(getMetrics({...base, trackedMs: 1_000}, now)).toMatchObject({progress: 0.25, workLeftMs: 3_000, health: 'TIGHT'});
    expect(getMetrics({...base, trackedMs: 2_000}, now)).toMatchObject({health: 'ON TRACK'});
    expect(getMetrics({...base, trackedMs: 5_000}, now)).toMatchObject({overrunMs: 1_000, health: 'ESTIMATE EXCEEDED'});
    expect(getMetrics({...base, deadlineAt: '2026-09-20T09:00:00.000Z'}, now)).toMatchObject({health: 'OVERDUE'});
    expect(getMetrics({...base, estimateMs: null}, now).health).toBe('UNKNOWN');
    expect(getMetrics({...base, status: 'completed'}, now)).toMatchObject({progress: 1, health: 'DONE'});
  });

  it('visually caps incomplete task progress at 99 percent', () => {
    const task = createTask({title: 'A', estimateMs: 1_000}, now);
    expect(getMetrics({...task, trackedMs: 2_000}, now).progress).toBe(0.99);
  });

  it('sorts by created time, deadline, title, or health', () => {
    const a = createTask({title: 'Zulu', deadlineAt: '2026-09-22T00:00:00.000Z'}, now);
    const b = createTask({title: 'Alpha', deadlineAt: '2026-09-21T00:00:00.000Z'}, at('2026-09-20T11:00:00.000Z'));
    expect(sortTasks([a, b], 'title', now).map(task => task.title)).toEqual(['Alpha', 'Zulu']);
    expect(sortTasks([a, b], 'deadline', now).map(task => task.title)).toEqual(['Alpha', 'Zulu']);
    expect(sortTasks([a, b], 'created', now).map(task => task.title)).toEqual(['Zulu', 'Alpha']);
  });
});
