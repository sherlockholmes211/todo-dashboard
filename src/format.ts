import {formatDuration, getMetrics, type Settings, type Task} from './domain.js';

export function formatDeadline(deadlineAt: string | null): string {
  if (!deadlineAt) return '—';
  const date = new Date(deadlineAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDueIn(task: Task, now: Date): string {
  if (!task.deadlineAt) return '—';
  if (task.status === 'completed') return 'Done';
  const remainingMs = new Date(task.deadlineAt).getTime() - now.getTime();
  const duration = formatDuration(Math.ceil(Math.abs(remainingMs) / 1_000) * 1_000);
  return remainingMs < 0 ? `${duration} overdue` : duration;
}

export function taskToJson(task: Task, now = new Date()): Record<string, unknown> {
  return {...task, metrics: getMetrics(task, now)};
}

export function formatTask(task: Task, now = new Date()): string {
  const metrics = getMetrics(task, now);
  return [
    `${task.id.slice(0, 8)}  ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority.toUpperCase()}`,
    `Tracked: ${formatDuration(metrics.effectiveTrackedMs)}`,
    `Estimate: ${task.estimateMs === null ? '—' : formatDuration(task.estimateMs)}`,
    `Effort left: ${metrics.workLeftMs === null ? '—' : formatDuration(metrics.workLeftMs)}`,
    `Progress: ${metrics.progress === null ? '—' : `${Math.round(metrics.progress * 100)}%`}`,
    `Deadline: ${task.deadlineAt ? new Date(task.deadlineAt).toLocaleString() : '—'}`,
    `Due in: ${formatDueIn(task, now)}`,
    `Health: ${metrics.health}${metrics.overrunMs ? ` by ${formatDuration(metrics.overrunMs)}` : ''}`
  ].join('\n');
}

export function formatDashboard(tasks: Task[], now = new Date(), settings?: Settings): string {
  const completed = settings?.showCompleted ?? false;
  const visible = tasks.filter(task => completed || task.status !== 'completed');
  if (visible.length === 0) return 'TODO DASHBOARD\n\nNo tasks. Add one with: todo add "My task"\n';
  const rows = visible.map(task => {
    const metrics = getMetrics(task, now);
    const marker = task.activeSince ? 'RUN' : task.status === 'completed' ? 'DONE' : 'WAIT';
    const effortLeft = metrics.workLeftMs === null ? '—' : formatDuration(metrics.workLeftMs);
    return `${task.id.slice(0, 8)}  ${marker.padEnd(5)}  ${task.title.padEnd(24)}  ${formatDuration(metrics.effectiveTrackedMs).padEnd(8)}  ${effortLeft.padEnd(12)}  ${formatDeadline(task.deadlineAt)}  ${formatDueIn(task, now).padEnd(12)}  ${`[${task.priority.toUpperCase()}]`.padEnd(10)}  ${metrics.health}`;
  });
  return `TODO DASHBOARD\n\nID        STATE  TASK                      TRACKED   EFFORT LEFT   DEADLINE          DUE IN        PRIORITY    HEALTH\n${rows.join('\n')}\n`;
}
