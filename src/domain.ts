import {randomUUID} from 'node:crypto';
import * as chrono from 'chrono-node';
import {z} from 'zod';

export const TITLE_MAX_LENGTH = 200;
export const colorThemeIds = ['default', 'lavender-dusk', 'sage-cream', 'misty-blue', 'rose-slate', 'soft-amber', 'quiet-monochrome', 'high-contrast'] as const;
export const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export type Priority = z.infer<typeof prioritySchema>;

export function parsePriority(value: string): Priority {
  const result = prioritySchema.safeParse(value.trim().toLowerCase());
  if (!result.success) throw new Error('Priority must be low, medium, high, or urgent');
  return result.data;
}

export const settingsSchema = z.object({
  colorTheme: z.enum(colorThemeIds).default('default'),
  borderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  titleColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  selectedBackgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  selectedTextColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  priorityColors: z.object({
    low: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    medium: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    high: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    urgent: z.string().regex(/^#[0-9a-fA-F]{6}$/)
  }).default({low: '#86EFAC', medium: '#93C5FD', high: '#FDE68A', urgent: '#FDA4AF'}),
  visibleColumns: z.array(z.enum(['id', 'state', 'task', 'tracked', 'effortLeft', 'deadline', 'dueIn', 'progress', 'priority', 'health'])).min(1).refine(columns => new Set(columns).size === columns.length, 'Columns must be unique').default(['id', 'state', 'task', 'tracked', 'effortLeft', 'deadline', 'dueIn', 'progress', 'priority', 'health']),
  monochrome: z.boolean().default(false),
  symbols: z.enum(['unicode', 'ascii']).default('unicode'),
  progressBarWidth: z.number().int().min(5).max(60).default(20),
  clock: z.enum(['12h', '24h']).default('24h'),
  defaultDeadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('23:59'),
  defaultSort: z.enum(['created', 'title', 'deadline', 'health']).default('created'),
  showCompleted: z.boolean().default(false),
  healthColors: z.record(z.string()).default({
    DONE: 'green',
    OVERDUE: 'red',
    'ESTIMATE EXCEEDED': 'red',
    'AT RISK': 'yellow',
    TIGHT: 'yellow',
    'ON TRACK': 'green',
    UNKNOWN: 'gray'
  })
});

export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = settingsSchema.parse({});

export const taskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(TITLE_MAX_LENGTH).refine(
    title => Array.from(title).every(character => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 31 && (codePoint < 127 || codePoint > 159);
    }),
    'Title must not contain control characters'
  ),
  description: z.string().trim().max(2000).refine(
    description => Array.from(description).every(character => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 31 && (codePoint < 127 || codePoint > 159);
    }),
    'Description must not contain control characters'
  ).default(''),
  status: z.enum(['pending', 'in_progress', 'completed']),
  priority: prioritySchema.default('medium'),
  estimateMs: z.number().positive().nullable(),
  trackedMs: z.number().nonnegative(),
  activeSince: z.string().datetime().nullable(),
  deadlineAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});

export type Task = z.infer<typeof taskSchema>;
export type TaskStatus = Task['status'];
export type Health = 'DONE' | 'OVERDUE' | 'ESTIMATE EXCEEDED' | 'AT RISK' | 'TIGHT' | 'ON TRACK' | 'UNKNOWN';
export type SortMode = 'created' | 'title' | 'deadline' | 'health';

export const storeSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  settings: settingsSchema,
  tasks: z.array(taskSchema)
});

export type Store = z.infer<typeof storeSchema>;

export function createStore(): Store {
  return {schemaVersion: 1, revision: 0, settings: {...defaultSettings}, tasks: []};
}

const durationPart = /(\d+(?:\.\d+)?)\s*(d|h|m|s)/gy;
const unitMs: Record<string, number> = {d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000};

export function parseDuration(value: string): number {
  const input = value.trim().toLowerCase();
  let total = 0;
  let position = 0;
  durationPart.lastIndex = 0;
  while (position < input.length) {
    durationPart.lastIndex = position;
    const match = durationPart.exec(input);
    if (!match || match.index !== position) throw new Error('Expected a positive duration such as 45m or 1h 30m');
    total += Number(match[1]) * (unitMs[match[2] ?? ''] ?? 0);
    position = durationPart.lastIndex;
    while (input[position] === ' ') position++;
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error('Expected a positive duration such as 45m or 1h 30m');
  return Math.round(total);
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : `${seconds % 60}s`;
}

export function parseDeadline(input: string, now = new Date(), defaultTime = '23:59'): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (dateOnly) {
    const [hours, minutes] = defaultTime.split(':').map(Number);
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), hours, minutes, 0, 0);
    if (date.getFullYear() !== Number(dateOnly[1]) || date.getMonth() !== Number(dateOnly[2]) - 1 || date.getDate() !== Number(dateOnly[3])) {
      throw new Error('Invalid deadline');
    }
    return date.toISOString();
  }
  const parsed = chrono.parseDate(input, now, {forwardDate: true});
  if (!parsed || Number.isNaN(parsed.getTime())) throw new Error('Invalid deadline');
  return parsed.toISOString();
}

type CreateTaskInput = {title: string; description?: string; estimateMs?: number | null; deadlineAt?: string | null; priority?: Priority};

export function createTask(input: CreateTaskInput, now = new Date(), id: string = randomUUID()): Task {
  const iso = now.toISOString();
  return taskSchema.parse({
    id,
    title: input.title,
    description: input.description ?? '',
    status: 'pending',
    priority: input.priority ?? 'medium',
    estimateMs: input.estimateMs ?? null,
    trackedMs: 0,
    activeSince: null,
    deadlineAt: input.deadlineAt ?? null,
    createdAt: iso,
    updatedAt: iso,
    completedAt: null
  });
}

export function effectiveTrackedMs(task: Task, now = new Date()): number {
  if (!task.activeSince) return task.trackedMs;
  return task.trackedMs + Math.max(0, now.getTime() - new Date(task.activeSince).getTime());
}

export function startTask(task: Task, now = new Date()): Task {
  if (task.status === 'completed') throw new Error('Completed tasks must be reopened before starting');
  if (task.activeSince) throw new Error('Task is already running');
  const iso = now.toISOString();
  return {...task, status: 'in_progress', activeSince: iso, updatedAt: iso};
}

export function pauseTask(task: Task, now = new Date()): Task {
  if (!task.activeSince) throw new Error('Task is not running');
  const iso = now.toISOString();
  return {...task, status: 'pending', trackedMs: effectiveTrackedMs(task, now), activeSince: null, updatedAt: iso};
}

export function completeTask(task: Task, now = new Date()): Task {
  if (task.status === 'completed') throw new Error('Task is already completed');
  const iso = now.toISOString();
  return {
    ...task,
    status: 'completed',
    trackedMs: effectiveTrackedMs(task, now),
    activeSince: null,
    updatedAt: iso,
    completedAt: iso
  };
}

export function reopenTask(task: Task, now = new Date()): Task {
  if (task.status !== 'completed') throw new Error('Task is not completed');
  return {...task, status: 'pending', completedAt: null, updatedAt: now.toISOString()};
}

type TaskChanges = {
  title?: string;
  description?: string;
  priority?: Priority;
  estimateMs?: number | null;
  remainingMs?: number;
  deadlineAt?: string | null;
};

export function updateTask(task: Task, changes: TaskChanges, now = new Date()): Task {
  let estimateMs = changes.estimateMs === undefined ? task.estimateMs : changes.estimateMs;
  if (changes.remainingMs !== undefined) {
    if (changes.remainingMs <= 0) throw new Error('Remaining time must be positive');
    estimateMs = effectiveTrackedMs(task, now) + changes.remainingMs;
  }
  return taskSchema.parse({
    ...task,
    ...(changes.title === undefined ? {} : {title: changes.title}),
    ...(changes.description === undefined ? {} : {description: changes.description}),
    ...(changes.priority === undefined ? {} : {priority: changes.priority}),
    ...(changes.deadlineAt === undefined ? {} : {deadlineAt: changes.deadlineAt}),
    estimateMs,
    updatedAt: now.toISOString()
  });
}

export function getMetrics(task: Task, now = new Date()): {
  effectiveTrackedMs: number;
  workLeftMs: number | null;
  progress: number | null;
  overrunMs: number;
  health: Health;
} {
  const spent = effectiveTrackedMs(task, now);
  const workLeftMs = task.estimateMs === null ? null : Math.max(task.estimateMs - spent, 0);
  const overrunMs = task.estimateMs === null ? 0 : Math.max(spent - task.estimateMs, 0);
  const rawProgress = task.estimateMs === null ? null : spent / task.estimateMs;
  const progress = task.status === 'completed' ? 1 : rawProgress === null ? null : Math.min(rawProgress, 0.99);
  let health: Health;
  if (task.status === 'completed') health = 'DONE';
  else if (task.deadlineAt && new Date(task.deadlineAt).getTime() < now.getTime()) health = 'OVERDUE';
  else if (overrunMs > 0 || (task.estimateMs !== null && spent >= task.estimateMs)) health = 'ESTIMATE EXCEEDED';
  else if (task.estimateMs === null || task.deadlineAt === null || workLeftMs === null) health = 'UNKNOWN';
  else {
    const available = new Date(task.deadlineAt).getTime() - now.getTime();
    if (workLeftMs > available) health = 'AT RISK';
    else if (workLeftMs >= available * 0.75) health = 'TIGHT';
    else health = 'ON TRACK';
  }
  return {effectiveTrackedMs: spent, workLeftMs, progress, overrunMs, health};
}

const healthRank: Record<Health, number> = {
  OVERDUE: 0,
  'ESTIMATE EXCEEDED': 1,
  'AT RISK': 2,
  TIGHT: 3,
  'ON TRACK': 4,
  UNKNOWN: 5,
  DONE: 6
};

export function sortTasks(tasks: Task[], mode: SortMode, now = new Date()): Task[] {
  return [...tasks].sort((a, b) => {
    if (mode === 'title') return a.title.localeCompare(b.title);
    if (mode === 'deadline') return (a.deadlineAt ?? '9999').localeCompare(b.deadlineAt ?? '9999');
    if (mode === 'health') return healthRank[getMetrics(a, now).health] - healthRank[getMetrics(b, now).health];
    return a.createdAt.localeCompare(b.createdAt);
  });
}
