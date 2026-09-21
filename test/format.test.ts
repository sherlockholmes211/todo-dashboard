import {describe, expect, it} from 'vitest';
import {completeTask, createTask} from '../src/domain.js';
import {formatDashboard, formatTask} from '../src/format.js';

const now = new Date('2026-09-20T10:00:00.000Z');

describe('task timing output', () => {
  it('includes priority in details and the static dashboard', () => {
    const task = createTask({title: 'Ship release', priority: 'high'}, now);
    expect(formatTask(task, now)).toContain('Priority: HIGH');
    expect(formatDashboard([task], now)).toContain('PRIORITY');
    expect(formatDashboard([task], now)).toContain('[HIGH]');
  });

  it('distinguishes effort remaining from time until the deadline in task details', () => {
    const task = {...createTask({title: 'Ship release', estimateMs: 14_400_000, deadlineAt: '2026-09-21T13:00:00.000Z'}, now), trackedMs: 3_600_000};
    const details = formatTask(task, now);
    expect(details).toContain('Effort left: 3h');
    expect(details).toContain('Due in: 1d 3h');
  });

  it('shows a deadline countdown in the static dashboard without requiring an estimate', () => {
    const task = createTask({title: 'Pay bill', deadlineAt: '2026-09-20T12:00:00.000Z'}, now);
    const dashboard = formatDashboard([task], now);
    expect(dashboard).toContain('EFFORT LEFT');
    expect(dashboard).toContain('DEADLINE');
    expect(dashboard).toContain('DUE IN');
    expect(dashboard).toMatch(/Pay bill\s+0s\s+—\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+2h/);
  });

  it('labels a passed deadline as overdue instead of showing zero time left', () => {
    const task = createTask({title: 'Pay bill', deadlineAt: '2026-09-20T09:00:00.000Z'}, now);
    expect(formatTask(task, now)).toContain('Due in: 1h overdue');
  });

  it('stops counting down a completed task', () => {
    const task = completeTask(createTask({title: 'Pay bill', deadlineAt: '2026-09-20T12:00:00.000Z'}, now), now);
    expect(formatTask(task, now)).toContain('Due in: Done');
  });
});
