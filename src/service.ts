import {
  completeTask,
  createTask,
  parseDeadline,
  parseDuration,
  parsePriority,
  pauseTask,
  reopenTask,
  settingsSchema,
  sortTasks,
  startTask,
  updateTask,
  type Settings,
  type SortMode,
  type Store,
  type Task
} from './domain.js';
import {StoreRepository} from './storage.js';

type AddOptions = {description?: string; estimate?: string; due?: string; priority?: string};
type EditOptions = {
  title?: string;
  description?: string;
  priority?: string;
  estimate?: string;
  remaining?: string;
  due?: string;
  clearEstimate?: boolean;
  clearDue?: boolean;
};

export class TodoService {
  constructor(
    readonly repository: StoreRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  getStore(): Promise<Store> {
    return this.repository.load();
  }

  async add(title: string, options: AddOptions = {}, id?: string): Promise<Task> {
    let created!: Task;
    await this.repository.mutate(store => {
      created = createTask({
        title,
        ...(options.description === undefined ? {} : {description: options.description}),
        priority: options.priority ? parsePriority(options.priority) : 'medium',
        estimateMs: options.estimate ? parseDuration(options.estimate) : null,
        deadlineAt: options.due ? parseDeadline(options.due, this.now(), store.settings.defaultDeadlineTime) : null
      }, this.now(), id);
      return {...store, tasks: [...store.tasks, created]};
    });
    return created;
  }

  async list(options: {all?: boolean; search?: string; sort?: SortMode} = {}): Promise<Task[]> {
    const store = await this.repository.load();
    const all = options.all ?? store.settings.showCompleted;
    const query = options.search?.trim().toLocaleLowerCase();
    const filtered = store.tasks.filter(task => (all || task.status !== 'completed') && (!query || task.title.toLocaleLowerCase().includes(query)));
    return sortTasks(filtered, options.sort ?? store.settings.defaultSort, this.now());
  }

  async show(prefix: string): Promise<Task> {
    return this.resolve((await this.repository.load()).tasks, prefix);
  }

  async edit(prefix: string, options: EditOptions): Promise<Task> {
    let result!: Task;
    await this.repository.mutate(store => {
      const current = this.resolve(store.tasks, prefix);
      const deadlineAt = options.clearDue ? null : options.due
        ? parseDeadline(options.due, this.now(), store.settings.defaultDeadlineTime)
        : undefined;
      result = updateTask(current, {
        ...(options.title === undefined ? {} : {title: options.title}),
        ...(options.description === undefined ? {} : {description: options.description}),
        ...(options.priority === undefined ? {} : {priority: parsePriority(options.priority)}),
        ...(options.clearEstimate ? {estimateMs: null} : options.estimate ? {estimateMs: parseDuration(options.estimate)} : {}),
        ...(options.remaining ? {remainingMs: parseDuration(options.remaining)} : {}),
        ...(deadlineAt === undefined ? {} : {deadlineAt})
      }, this.now());
      return {...store, tasks: store.tasks.map(task => task.id === current.id ? result : task)};
    });
    return result;
  }

  start(prefix: string): Promise<Task> {
    return this.changeTask(prefix, task => startTask(task, this.now()));
  }

  pause(prefix: string): Promise<Task> {
    return this.changeTask(prefix, task => pauseTask(task, this.now()));
  }

  done(prefix: string): Promise<Task> {
    return this.changeTask(prefix, task => completeTask(task, this.now()));
  }

  reopen(prefix: string): Promise<Task> {
    return this.changeTask(prefix, task => reopenTask(task, this.now()));
  }

  async pauseAll(): Promise<Task[]> {
    let paused: Task[] = [];
    await this.repository.mutate(store => {
      const now = this.now();
      paused = store.tasks.filter(task => task.activeSince !== null).map(task => pauseTask(task, now));
      if (paused.length === 0) throw new Error('No running tasks to pause');
      const replacements = new Map(paused.map(task => [task.id, task]));
      return {...store, tasks: store.tasks.map(task => replacements.get(task.id) ?? task)};
    });
    return paused;
  }

  async delete(prefix: string): Promise<Task> {
    let deleted!: Task;
    await this.repository.mutate(store => {
      deleted = this.resolve(store.tasks, prefix);
      return {...store, tasks: store.tasks.filter(task => task.id !== deleted.id)};
    });
    return deleted;
  }

  async listConfig(): Promise<Settings> {
    return (await this.repository.load()).settings;
  }

  async getConfig(key: string): Promise<unknown> {
    const settings = await this.listConfig();
    if (!(key in settings)) throw new Error(`Unknown configuration key: ${key}`);
    return settings[key as keyof Settings];
  }

  async setConfig(key: string, rawValue: string): Promise<Settings> {
    let settings!: Settings;
    await this.repository.mutate(store => {
      if (!(key in store.settings)) throw new Error(`Unknown configuration key: ${key}`);
      const current = store.settings[key as keyof Settings];
      let value: unknown = rawValue;
      if (typeof current === 'boolean') {
        if (!['true', 'false'].includes(rawValue)) throw new Error(`${key} must be true or false`);
        value = rawValue === 'true';
      } else if (typeof current === 'number') {
        value = Number(rawValue);
      } else if (key.endsWith('Color')) {
        value = rawValue === 'default' ? null : rawValue;
      } else if (key === 'visibleColumns') {
        value = rawValue.split(',').map(column => column.trim());
      } else if (typeof current === 'object') {
        try { value = JSON.parse(rawValue); } catch { throw new Error(`${key} must be valid JSON`); }
        if ((key === 'priorityColors' || key === 'healthColors') && value && typeof value === 'object' && !Array.isArray(value)) value = {...current, ...value};
      }
      settings = settingsSchema.parse({...store.settings, [key]: value});
      return {...store, settings};
    });
    return settings;
  }

  private async changeTask(prefix: string, operation: (task: Task) => Task): Promise<Task> {
    let result!: Task;
    await this.repository.mutate(store => {
      const current = this.resolve(store.tasks, prefix);
      result = operation(current);
      return {...store, tasks: store.tasks.map(task => task.id === current.id ? result : task)};
    });
    return result;
  }

  private resolve(tasks: Task[], prefix: string): Task {
    const normalized = prefix.toLocaleLowerCase();
    const matches = tasks.filter(task => task.id.toLocaleLowerCase().startsWith(normalized));
    if (matches.length === 0) throw new Error(`Task not found: ${prefix}`);
    if (matches.length > 1) throw new Error(`Ambiguous task ID prefix: ${prefix}`);
    return matches[0]!;
  }
}
