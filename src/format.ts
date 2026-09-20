import {formatDuration, getMetrics, type Settings, type Task} from './domain.js';

export function taskToJson(task: Task, now = new Date()): Record<string, unknown> {
  return {...task, metrics: getMetrics(task, now)};
}

export function formatTask(task: Task, now = new Date()): string {
  const metrics = getMetrics(task, now);
  return [
    `${task.id.slice(0, 8)}  ${task.title}`,
    `Status: ${task.status}`,
    `Tracked: ${formatDuration(metrics.effectiveTrackedMs)}`,
    `Estimate: ${task.estimateMs === null ? '—' : formatDuration(task.estimateMs)}`,
    `Work left: ${metrics.workLeftMs === null ? '—' : formatDuration(metrics.workLeftMs)}`,
    `Progress: ${metrics.progress === null ? '—' : `${Math.round(metrics.progress * 100)}%`}`,
    `Deadline: ${task.deadlineAt ? new Date(task.deadlineAt).toLocaleString() : '—'}`,
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
    return `${task.id.slice(0, 8)}  ${marker.padEnd(4)}  ${task.title}  ${formatDuration(metrics.effectiveTrackedMs)}  ${metrics.health}`;
  });
  return `TODO DASHBOARD\n\nID        STATE  TASK  TRACKED  HEALTH\n${rows.join('\n')}\n`;
}
