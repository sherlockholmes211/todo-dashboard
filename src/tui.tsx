import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {defaultSettings, formatDuration, getMetrics, sortTasks, type Settings, type SortMode, type Task} from './domain.js';
import type {TodoService} from './service.js';

export type DashboardAction = 'start' | 'pause' | 'pauseAll' | 'done' | 'reopen' | 'delete' | 'details' | 'new' | 'edit' | 'settings';

type DashboardProps = {
  tasks: Task[];
  settings?: Partial<Settings>;
  width?: number;
  now?: () => Date;
  onAction?: (action: DashboardAction, task?: Task, value?: string) => void;
};

export function TextPrompt({label, initial = '', onSubmit, onCancel}: {
  label: string;
  initial?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const update = (next: string) => {
    valueRef.current = next;
    setValue(next);
  };
  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return) onSubmit(valueRef.current);
    else if (key.backspace || key.delete) update(valueRef.current.slice(0, -1));
    else if (!key.ctrl && !key.meta && input) update(valueRef.current + input);
  });
  return <Box flexDirection="column"><Text>{label}</Text><Text>&gt; {value}█</Text><Text dimColor>Enter confirms · Esc cancels</Text></Box>;
}

export function Dashboard({tasks, settings: overrides, width = process.stdout.columns ?? 80, now = () => new Date(), onAction}: DashboardProps) {
  const settings = {...defaultSettings, ...overrides};
  const [selected, setSelected] = useState(0);
  const [help, setHelp] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<SortMode>(settings.defaultSort);
  const [filter, setFilter] = useState<'all' | 'pending' | 'running' | 'completed'>('all');
  const {exit} = useApp();
  const visible = useMemo(() => sortTasks(tasks.filter(task =>
    (settings.showCompleted || task.status !== 'completed') &&
    (filter === 'all' || filter === 'running' && task.activeSince !== null || filter === 'pending' && task.status === 'pending' || filter === 'completed' && task.status === 'completed') &&
    task.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  ), sort, now()), [tasks, settings.showCompleted, filter, query, sort, now]);
  const activeIndex = Math.min(selected, Math.max(visible.length - 1, 0));
  const active = visible[activeIndex];

  useInput((input, key) => {
    if (searching) {
      if (key.escape || key.return) setSearching(false);
      else if (key.backspace || key.delete) setQuery(value => value.slice(0, -1));
      else if (input) setQuery(value => value + input);
      return;
    }
    if (input === 'q') exit();
    else if (input === '?' || (help && key.escape)) setHelp(value => !value);
    else if (input === '/' ) setSearching(true);
    else if (key.downArrow || input === 'j') setSelected(value => Math.min(value + 1, visible.length - 1));
    else if (key.upArrow || input === 'k') setSelected(value => Math.max(value - 1, 0));
    else if (key.return && active) onAction?.('details', active);
    else if (input === 'n') onAction?.('new');
    else if (input === 'e' && active) onAction?.('edit', active);
    else if (input === 's' && active) onAction?.('start', active);
    else if (input === 'p' && active) onAction?.('pause', active);
    else if (input === 'P') onAction?.('pauseAll');
    else if (input === 'c' && active) onAction?.('done', active);
    else if (input === 'r' && active) onAction?.('reopen', active);
    else if (input === 'd' && active) onAction?.('delete', active);
    else if (input === ',') onAction?.('settings');
    else if (input === 'f') setFilter(value => value === 'all' ? 'pending' : value === 'pending' ? 'running' : value === 'running' ? 'completed' : 'all');
    else if (input === 'o') setSort(value => value === 'created' ? 'deadline' : value === 'deadline' ? 'title' : value === 'title' ? 'health' : 'created');
  });

  if (help) return <Box flexDirection="column"><Text bold>Keyboard shortcuts</Text><Text>j/k or arrows navigate · Enter details · n new · e edit · s start · p pause · P pause all</Text><Text>c complete · r reopen · d delete · / search · o sort · , settings · ? help · q quit</Text></Box>;

  const symbol = settings.symbols === 'ascii' ? '>' : '›';
  const layout = width >= 100 ? 'wide' : width >= 60 ? 'medium' : 'narrow';
  return <Box flexDirection="column">
    <Text bold>TODO DASHBOARD</Text>
    <Text>{visible.length} tasks · filter {filter} · sort {sort}{query ? ` · search: ${query}` : ''}{searching ? '█' : ''}</Text>
    {layout !== 'narrow' && <Text bold>{layout === 'wide' ? '  ID        STATE       TASK                          TRACKED    WORK LEFT  PROGRESS  HEALTH' : '  STATE       TASK                         TRACKED   HEALTH'}</Text>}
    {visible.length === 0 && <Text>No tasks. Press n to create one.</Text>}
    {visible.map((task, index) => {
      const metrics = getMetrics(task, now());
      const color = settings.monochrome ? undefined : settings.healthColors[metrics.health];
      const selectedMarker = index === activeIndex ? symbol : ' ';
      const state = task.activeSince ? 'RUNNING' : task.status === 'completed' ? 'DONE' : 'PENDING';
      const colored = color ? {color} : {};
      if (layout === 'narrow') return <Text key={task.id} {...colored}>{selectedMarker} {state === 'RUNNING' ? '*' : '-'} {task.title} [{metrics.health}]</Text>;
      if (layout === 'medium') return <Text key={task.id} {...colored}>{selectedMarker} {state.padEnd(11)} {task.title.slice(0, 28).padEnd(29)} {formatDuration(metrics.effectiveTrackedMs).padEnd(9)} {metrics.health}</Text>;
      return <Text key={task.id} {...colored}>{selectedMarker} {task.id.slice(0, 8)}  {state.padEnd(11)} {task.title.slice(0, 29).padEnd(30)} {formatDuration(metrics.effectiveTrackedMs).padEnd(10)} {(metrics.workLeftMs === null ? '—' : formatDuration(metrics.workLeftMs)).padEnd(10)} {progressBar(metrics.progress, settings.progressBarWidth, settings.symbols)} {metrics.health}</Text>;
    })}
    {layout === 'narrow' && active && <Text>Selected: {active.title} · tracked {formatDuration(getMetrics(active, now()).effectiveTrackedMs)}</Text>}
    <Text dimColor>j/k navigate · f filter · o sort · ? help · q quit</Text>
  </Box>;
}

function progressBar(progress: number | null, width: number, symbols: Settings['symbols']): string {
  if (progress === null) return '—'.padEnd(width + 7);
  const filled = Math.round(progress * width);
  const on = symbols === 'unicode' ? '█' : '#';
  const off = symbols === 'unicode' ? '░' : '-';
  return `${on.repeat(filled)}${off.repeat(width - filled)} ${String(Math.round(progress * 100)).padStart(3)}%`;
}

type EditorModal = {
  kind: 'new' | 'edit';
  step: 'title' | 'estimate' | 'date' | 'time';
  task?: Task;
  title: string;
  estimate: string;
  date: string;
  time: string;
};

type Modal = EditorModal | {kind: 'delete'; task: Task} | {kind: 'details'; task: Task} | {kind: 'settings'};

function localDateParts(value: string | null): {date: string; time: string} {
  if (!value) return {date: '', time: ''};
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  };
}

export function TodoApp({service}: {service: TodoService}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [, setTick] = useState(0);
  const [message, setMessage] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const reload = async () => {
    const store = await service.getStore();
    setTasks(store.tasks);
    setSettings(store.settings);
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  const action = async (name: DashboardAction, task?: Task) => {
    try {
      if (name === 'new') {
        setModal({kind: 'new', step: 'title', title: '', estimate: '', date: '', time: ''});
        return;
      } else if (name === 'edit' && task) {
        const due = localDateParts(task.deadlineAt);
        setModal({kind: 'edit', step: 'title', task, title: task.title, estimate: task.estimateMs ? formatDuration(task.estimateMs) : '', ...due});
        return;
      } else if (name === 'delete' && task) {
        setModal({kind: 'delete', task});
        return;
      } else if (name === 'details' && task) {
        setModal({kind: 'details', task});
        return;
      } else if (name === 'settings') {
        setModal({kind: 'settings'});
        return;
      } else if (name === 'start' && task) await service.start(task.id);
      else if (name === 'pause' && task) await service.pause(task.id);
      else if (name === 'pauseAll') await service.pauseAll();
      else if (name === 'done' && task) await service.done(task.id);
      else if (name === 'reopen' && task) await service.reopen(task.id);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const submitEditor = async (value: string) => {
    if (!modal || (modal.kind !== 'new' && modal.kind !== 'edit')) return;
    if (modal.step === 'title') setModal({...modal, title: value, step: 'estimate'});
    else if (modal.step === 'estimate') setModal({...modal, estimate: value, step: 'date'});
    else if (modal.step === 'date') {
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) setModal({...modal, date: value, step: 'time'});
      else {
        const finished = {...modal, date: value};
        try { await saveEditor(finished); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      }
    } else {
      const finished = {...modal, time: value};
      try { await saveEditor(finished); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    }
  };

  const saveEditor = async (editor: EditorModal) => {
    const due = editor.date ? `${editor.date}${editor.time ? ` ${editor.time}` : ''}` : undefined;
    if (editor.kind === 'new') {
      await service.add(editor.title, {...(editor.estimate ? {estimate: editor.estimate} : {}), ...(due ? {due} : {})});
    } else if (editor.task) {
      await service.edit(editor.task.id, {
        title: editor.title,
        ...(editor.estimate ? {estimate: editor.estimate} : {clearEstimate: true}),
        ...(due ? {due} : {clearDue: true})
      });
    }
    setModal(null);
    setMessage(editor.kind === 'new' ? 'Task created' : 'Task updated');
    await reload();
  };

  if (modal?.kind === 'new' || modal?.kind === 'edit') {
    const labels = {title: 'Task title', estimate: 'Estimate (for example 1h 30m; blank for none)', date: 'Deadline date/natural language (blank for none)', time: 'Deadline time (HH:mm; blank uses default)'};
    return <TextPrompt
      key={`${modal.kind}-${modal.step}`}
      label={labels[modal.step]}
      initial={modal[modal.step]}
      onSubmit={value => { void submitEditor(value); }}
      onCancel={() => setModal(null)}
    />;
  }
  if (modal?.kind === 'delete') return <Confirmation
    text={`Delete "${modal.task.title}"?`}
    onAnswer={async confirmed => {
      if (confirmed) await service.delete(modal.task.id);
      setModal(null);
      setMessage(confirmed ? 'Task deleted' : 'Deletion cancelled');
      await reload();
    }}
  />;
  if (modal?.kind === 'details') return <Dismissible title={modal.task.title} onClose={() => setModal(null)}><Text>{modal.task.id}</Text><Text>Status: {modal.task.status}</Text><Text>Tracked: {formatDuration(getMetrics(modal.task).effectiveTrackedMs)}</Text><Text>Deadline: {modal.task.deadlineAt ? new Date(modal.task.deadlineAt).toLocaleString() : '—'}</Text></Dismissible>;
  if (modal?.kind === 'settings') return <SettingsPanel settings={settings} service={service} onClose={async () => { setModal(null); await reload(); }} />;
  return <Box flexDirection="column"><Dashboard tasks={tasks} settings={{...settings, monochrome: settings.monochrome || process.env.NO_COLOR !== undefined}} onAction={(name, task) => { void action(name, task); }} />{message && <Text>{message}</Text>}</Box>;
}

function Confirmation({text, onAnswer}: {text: string; onAnswer: (answer: boolean) => void | Promise<void>}) {
  useInput(input => {
    if (input.toLocaleLowerCase() === 'y') void onAnswer(true);
    else if (input.toLocaleLowerCase() === 'n' || input === '\u001b') void onAnswer(false);
  });
  return <Text>{text} [y/N]</Text>;
}

function Dismissible({title, onClose, children}: {title: string; onClose: () => void; children: React.ReactNode}) {
  useInput((_input, key) => { if (key.escape || key.return) onClose(); });
  return <Box flexDirection="column"><Text bold>{title}</Text>{children}<Text dimColor>Enter/Esc returns</Text></Box>;
}

function SettingsPanel({settings, service, onClose}: {settings: Settings; service: TodoService; onClose: () => void | Promise<void>}) {
  const [current, setCurrent] = useState(settings);
  const change = async (key: string, value: string) => {
    const updated = await service.setConfig(key, value);
    setCurrent(updated);
  };
  useInput((input, key) => {
    if (key.escape || key.return) void onClose();
    else if (input === 'm') void change('monochrome', String(!current.monochrome));
    else if (input === 'u') void change('symbols', current.symbols === 'unicode' ? 'ascii' : 'unicode');
    else if (input === 't') void change('clock', current.clock === '24h' ? '12h' : '24h');
    else if (input === 'c') void change('showCompleted', String(!current.showCompleted));
  });
  return <Box flexDirection="column"><Text bold>Settings</Text><Text>m monochrome: {String(current.monochrome)}</Text><Text>u symbols: {current.symbols}</Text><Text>t clock: {current.clock}</Text><Text>c show completed: {String(current.showCompleted)}</Text><Text dimColor>Enter/Esc returns</Text></Box>;
}
