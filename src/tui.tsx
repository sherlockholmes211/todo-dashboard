import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {colorThemeIds, defaultSettings, formatDuration, getMetrics, parseDuration, parsePriority, sortTasks, taskSchema, type Health, type Priority, type Settings, type SortMode, type Task} from './domain.js';
import {formatDeadline, formatDueIn} from './format.js';
import type {TodoService} from './service.js';

export type DashboardAction = 'start' | 'pause' | 'pauseAll' | 'done' | 'reopen' | 'delete' | 'details' | 'new' | 'edit' | 'settings';
type DashboardColumn = Settings['visibleColumns'][number];

const columnLabels: Record<DashboardColumn, string> = {
  id: 'ID', state: 'STATE', task: 'TASK', tracked: 'TRACKED', effortLeft: 'EFFORT LEFT',
  deadline: 'DEADLINE', dueIn: 'DUE IN', progress: 'PROGRESS', priority: 'PRIORITY', health: 'HEALTH'
};
const columnWidths: Record<DashboardColumn, number> = {
  id: 10, state: 12, task: 25, tracked: 10, effortLeft: 13,
  deadline: 18, dueIn: 13, progress: 27, priority: 11, health: 20
};

type DashboardProps = {
  tasks: Task[];
  settings?: Partial<Settings>;
  width?: number;
  now?: () => Date;
  onAction?: (action: DashboardAction, task?: Task, value?: string) => void;
};

const pastelHealthColors: Record<Health, string> = {
  DONE: '#A7F3D0',
  OVERDUE: '#FDA4AF',
  'ESTIMATE EXCEEDED': '#FCA5A5',
  'AT RISK': '#FDBA74',
  TIGHT: '#FDE68A',
  'ON TRACK': '#A7F3D0',
  UNKNOWN: '#CBD5E1'
};

function PriorityBadge({priority, monochrome, colors}: {priority: Priority; monochrome: boolean; colors: Settings['priorityColors']}) {
  return <Text bold={!monochrome} {...(monochrome ? {} : {color: colors[priority]})}>[{priority.toUpperCase()}]</Text>;
}

const themePalettes: Record<Settings['colorTheme'], {border: string; title: string; accent: string; selectedBackground: string; selectedText: string}> = {
  default: {border: '#C4B5FD', title: '#DDD6FE', accent: '#A7F3D0', selectedBackground: '#EDE9FE', selectedText: '#312E40'},
  'lavender-dusk': {border: '#A99AC8', title: '#E5DDF3', accent: '#ABD8CA', selectedBackground: '#373348', selectedText: '#F7F4F2'},
  'sage-cream': {border: '#93B3A5', title: '#E1E9DA', accent: '#B8D5BC', selectedBackground: '#30453C', selectedText: '#F7F4F2'},
  'misty-blue': {border: '#9CB7CF', title: '#DDE8F2', accent: '#E6BEA8', selectedBackground: '#304357', selectedText: '#F7F4F2'},
  'rose-slate': {border: '#BE9BAE', title: '#F0DCE5', accent: '#A9C7D4', selectedBackground: '#463746', selectedText: '#F7F4F2'},
  'soft-amber': {border: '#BCA984', title: '#F0E0BE', accent: '#B4D1C3', selectedBackground: '#463E31', selectedText: '#F7F4F2'},
  'quiet-monochrome': {border: '#858B97', title: '#E4E6EA', accent: '#B4BBC5', selectedBackground: '#343941', selectedText: '#F7F4F2'},
  'high-contrast': {border: '#FFFFFF', title: '#00FFFF', accent: '#FFFF00', selectedBackground: '#FFFFFF', selectedText: '#000000'}
};

const themeLabels: Record<Settings['colorTheme'], string> = {
  default: 'Default',
  'lavender-dusk': 'Lavender dusk',
  'sage-cream': 'Sage & cream',
  'misty-blue': 'Misty blue & peach',
  'rose-slate': 'Rose & slate',
  'soft-amber': 'Soft amber',
  'quiet-monochrome': 'Quiet monochrome',
  'high-contrast': 'High contrast'
};

function screenPalette(settings: Settings) {
  const base = themePalettes[settings.colorTheme];
  return {
    border: settings.borderColor ?? base.border,
    title: settings.titleColor ?? base.title,
    accent: settings.accentColor ?? base.accent,
    selectedBackground: settings.selectedBackgroundColor ?? base.selectedBackground,
    selectedText: settings.selectedTextColor ?? base.selectedText
  };
}

function ScreenPanel({settings, title, height, children}: {settings: Settings; title: string; height: number; children: React.ReactNode}) {
  const palette = screenPalette(settings);
  const monochrome = settings.monochrome || process.env.NO_COLOR !== undefined;
  return <Box
    borderStyle={settings.symbols === 'ascii' ? 'classic' : 'round'}
    {...(monochrome ? {} : {borderColor: palette.border})}
    flexDirection="column"
    paddingX={1}
    minHeight={height}
    width="100%"
  >
    <Text bold={!monochrome} {...(monochrome ? {} : {color: palette.title})}>{title}</Text>
    {children}
  </Box>;
}

export function TextPrompt({label, initial = '', error, onSubmit, onCancel}: {
  label: string;
  initial?: string;
  error?: string;
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
  return <Box flexDirection="column"><Text>{label}</Text><Text>&gt; {value}█</Text>{error && <Text color="red">{error}</Text>}<Text dimColor>Enter confirms · Esc cancels</Text></Box>;
}

export function Dashboard({tasks, settings: overrides, width = process.stdout.columns ?? 80, now = () => new Date(), onAction}: DashboardProps) {
  const settings = {...defaultSettings, ...overrides};
  const palette = screenPalette(settings);
  const textColor = (value: string) => settings.monochrome ? {} : {color: value};
  const borderColor = settings.monochrome ? {} : {borderColor: palette.border};
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
  const borderStyle = settings.symbols === 'ascii' ? 'classic' : 'round';

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

  if (help) return <Box borderStyle={borderStyle} {...borderColor} flexDirection="column" paddingX={1} width="100%">
    <Text bold={!settings.monochrome} {...textColor(palette.title)}>Keyboard shortcuts</Text>
    <Text>j/k or arrows navigate · Enter details · n new · e edit · s start · p pause · P pause all</Text>
    <Text>c complete · r reopen · d delete · / search · o sort · , settings · ? help · q quit</Text>
  </Box>;

  const symbol = settings.symbols === 'ascii' ? '>' : '›';
  const layout = width >= 135 ? 'wide' : width >= 80 ? 'medium' : 'narrow';
  const showProgress = layout === 'wide' && width >= 147 + settings.progressBarWidth;
  const customColumns = settings.visibleColumns.join(',') !== defaultSettings.visibleColumns.join(',');
  const columns = settings.visibleColumns;
  const selectedTime = now();
  const selectedWorkLeft = active ? getMetrics(active, selectedTime).workLeftMs : null;
  return <Box flexDirection="column" width="100%">
    <Box borderStyle={borderStyle} {...borderColor} flexDirection="column" paddingX={1} width="100%">
      <Text bold={!settings.monochrome} {...textColor(palette.title)}>TODO DASHBOARD</Text>
      <Text {...textColor(palette.accent)}>{visible.length} tasks · filter {filter} · sort {sort}{query ? ` · search: ${query}` : ''}{searching ? '█' : ''}</Text>
    </Box>
    <Box marginTop={1} borderStyle={borderStyle} {...borderColor} flexDirection="column" paddingX={1} width="100%">
      <Text bold={!settings.monochrome} {...textColor(palette.title)}>TASKS</Text>
      {layout !== 'narrow' && <Text bold={!settings.monochrome} {...textColor(palette.accent)}>{customColumns ? `  ${columns.map(column => columnLabels[column].padEnd(columnWidths[column])).join('')}` : layout === 'wide' ? `  ID        STATE       TASK                      TRACKED   EFFORT LEFT  DEADLINE          DUE IN       ${showProgress ? `${'PROGRESS'.padEnd(settings.progressBarWidth + 6)} ` : ''}PRIORITY  HEALTH` : '  STATE       TASK                EFFORT LEFT  DUE IN       PRIORITY  HEALTH'}</Text>}
      {visible.length === 0 && <Text>No tasks. Press n to create one.</Text>}
      {visible.map((task, index) => {
        const currentTime = now();
        const metrics = getMetrics(task, currentTime);
        const effortLeft = metrics.workLeftMs === null ? '—' : formatDuration(metrics.workLeftMs);
        const dueIn = formatDueIn(task, currentTime);
        const selectedMarker = index === activeIndex ? symbol : ' ';
        const state = task.activeSince ? 'RUNNING' : task.status === 'completed' ? 'DONE' : 'PENDING';
        const selected = index === activeIndex;
        const configuredHealthColor = settings.healthColors[metrics.health];
        const healthColor = settings.colorTheme !== 'high-contrast' && configuredHealthColor === defaultSettings.healthColors[metrics.health]
          ? pastelHealthColors[metrics.health]
          : configuredHealthColor ?? palette.title;
        const colored = {
          ...textColor(selected ? palette.selectedText : healthColor),
          ...(selected && !settings.monochrome ? {backgroundColor: palette.selectedBackground} : {}),
          bold: selected && !settings.monochrome
        };
        if (customColumns && layout === 'narrow') {
          const values: Record<DashboardColumn, string> = {
            id: task.id.slice(0, 8), state, task: task.title, tracked: formatDuration(metrics.effectiveTrackedMs),
            effortLeft, deadline: formatDeadline(task.deadlineAt), dueIn,
            progress: progressBar(metrics.progress, settings.progressBarWidth, settings.symbols),
            priority: `[${task.priority.toUpperCase()}]`, health: metrics.health
          };
          return <Text key={task.id} {...colored}>{selectedMarker} {columns.map(column => column === 'task' ? values.task : `${columnLabels[column].toLowerCase()} ${values[column]}`).join(' · ')}</Text>;
        }
        if (customColumns && layout !== 'narrow') {
          const cells: Record<DashboardColumn, string> = {
            id: task.id.slice(0, 8), state, task: task.title, tracked: formatDuration(metrics.effectiveTrackedMs),
            effortLeft, deadline: formatDeadline(task.deadlineAt), dueIn,
            progress: progressBar(metrics.progress, settings.progressBarWidth, settings.symbols),
            priority: `[${task.priority.toUpperCase()}]`, health: metrics.health
          };
          return <Box key={task.id}><Text {...colored}>{selectedMarker} </Text>{columns.map(column => column === 'priority'
            ? <React.Fragment key={column}><PriorityBadge priority={task.priority} monochrome={settings.monochrome} colors={settings.priorityColors} /><Text>{' '.repeat(Math.max(1, columnWidths.priority - cells.priority.length))}</Text></React.Fragment>
            : <Text key={column} {...colored}>{cells[column].slice(0, columnWidths[column] - 1).padEnd(columnWidths[column])}</Text>)}</Box>;
        }
        if (layout === 'narrow') return <Text key={task.id} {...colored}>{selectedMarker} {state === 'RUNNING' ? '*' : '-'} {task.title} <PriorityBadge priority={task.priority} monochrome={settings.monochrome} colors={settings.priorityColors} /> [{metrics.health}]</Text>;
        if (layout === 'medium') return <Text key={task.id} {...colored}>{selectedMarker} {state.padEnd(11)} {task.title.slice(0, 18).padEnd(19)} {effortLeft.padEnd(12)} {dueIn.padEnd(12)} <PriorityBadge priority={task.priority} monochrome={settings.monochrome} colors={settings.priorityColors} /> {metrics.health}</Text>;
        return <Text key={task.id} {...colored}>{selectedMarker} {task.id.slice(0, 8)}  {state.padEnd(11)} {task.title.slice(0, 24).padEnd(25)} {formatDuration(metrics.effectiveTrackedMs).padEnd(9)} {effortLeft.padEnd(12)} {formatDeadline(task.deadlineAt).padEnd(17)} {dueIn.padEnd(12)} {showProgress ? `${progressBar(metrics.progress, settings.progressBarWidth, settings.symbols)} ` : ''}<PriorityBadge priority={task.priority} monochrome={settings.monochrome} colors={settings.priorityColors} /> {metrics.health}</Text>;
      })}
      {layout === 'narrow' && active && !customColumns && <><Text>Selected: {active.title}</Text><Text>effort left {selectedWorkLeft === null ? '—' : formatDuration(selectedWorkLeft)} · due in {formatDueIn(active, selectedTime)}</Text></>}
    </Box>
    <Text dimColor={!settings.monochrome}>j/k navigate · f filter · o sort · , settings · {searching ? 'Enter/Esc exit search' : '/ search'} · ? help · q quit</Text>
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
  step: 'title' | 'estimate' | 'priority' | 'date' | 'time';
  task?: Task;
  title: string;
  estimate: string;
  priority: string;
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
  const [editorError, setEditorError] = useState('');
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
        setEditorError('');
        setModal({kind: 'new', step: 'title', title: '', estimate: '', priority: 'medium', date: '', time: ''});
        return;
      } else if (name === 'edit' && task) {
        setEditorError('');
        const due = localDateParts(task.deadlineAt);
        setModal({kind: 'edit', step: 'title', task, title: task.title, estimate: task.estimateMs ? formatDuration(task.estimateMs) : '', priority: task.priority, ...due});
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
    setEditorError('');
    if (modal.step === 'title') {
      if (!value.trim()) setEditorError('Title is required');
      else {
        const result = taskSchema.shape.title.safeParse(value);
        if (!result.success) setEditorError(result.error.issues[0]?.message ?? 'Invalid title');
        else setModal({...modal, title: result.data, step: 'estimate'});
      }
    } else if (modal.step === 'estimate') {
      try {
        if (value) parseDuration(value);
        setModal({...modal, estimate: value, step: 'priority'});
      } catch (error) { setEditorError(error instanceof Error ? error.message : String(error)); }
    }
    else if (modal.step === 'priority') {
      try { setModal({...modal, priority: parsePriority(value), step: 'date'}); }
      catch (error) { setEditorError(error instanceof Error ? error.message : String(error)); }
    }
    else if (modal.step === 'date') {
      if (!value) {
        try { await saveEditor({...modal, date: '', time: ''}); } catch (error) { setEditorError(error instanceof Error ? error.message : String(error)); }
      } else if (isValidDate(value)) setModal({...modal, date: value, step: 'time'});
      else setEditorError('Enter a valid date as YYYY-MM-DD, or leave blank');
    } else {
      if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        setEditorError('Enter time as HH:mm, or leave blank');
        return;
      }
      const finished = {...modal, time: value};
      try { await saveEditor(finished); } catch (error) { setEditorError(error instanceof Error ? error.message : String(error)); }
    }
  };

  const saveEditor = async (editor: EditorModal) => {
    const due = editor.date ? `${editor.date}${editor.time ? ` ${editor.time}` : ''}` : undefined;
    if (editor.kind === 'new') {
      await service.add(editor.title, {priority: editor.priority, ...(editor.estimate ? {estimate: editor.estimate} : {}), ...(due ? {due} : {})});
    } else if (editor.task) {
      await service.edit(editor.task.id, {
        title: editor.title,
        priority: editor.priority,
        ...(editor.estimate ? {estimate: editor.estimate} : {clearEstimate: true}),
        ...(due ? {due} : {clearDue: true})
      });
    }
    setModal(null);
    setMessage(editor.kind === 'new' ? 'Task created' : 'Task updated');
    await reload();
  };

  const visibleTaskCount = tasks.filter(task => settings.showCompleted || task.status !== 'completed').length;
  // Match the dashboard's summary, gap, task panel, and footer around its task rows.
  const screenHeight = 10 + Math.max(1, visibleTaskCount) + (visibleTaskCount > 0 && (process.stdout.columns ?? 80) < 80 ? 1 : 0);

  if (modal?.kind === 'new' || modal?.kind === 'edit') {
    const labels = {title: 'Task title', estimate: 'Estimate (for example 1h 30m; blank for none)', priority: 'Priority (low, medium, high, urgent)', date: 'Deadline date (YYYY-MM-DD; blank for none)', time: 'Deadline time (HH:mm; blank uses default)'};
    const step = ['title', 'estimate', 'priority', 'date', 'time'].indexOf(modal.step) + 1;
    const monochrome = settings.monochrome || process.env.NO_COLOR !== undefined;
    return <ScreenPanel settings={settings} title={modal.kind === 'new' ? 'NEW TASK' : 'EDIT TASK'} height={screenHeight}>
      <Text {...(monochrome ? {} : {color: screenPalette(settings).accent})}>Step {step} of 5</Text>
      <Box marginTop={1}>
        <TextPrompt
          key={`${modal.kind}-${modal.step}`}
          label={labels[modal.step]}
          initial={modal[modal.step]}
          error={editorError}
          onSubmit={value => { void submitEditor(value); }}
          onCancel={() => setModal(null)}
        />
      </Box>
    </ScreenPanel>;
  }
  if (modal?.kind === 'delete') {
    const monochrome = settings.monochrome || process.env.NO_COLOR !== undefined;
    return <ScreenPanel settings={settings} title="DELETE TASK" height={screenHeight}>
      <Box flexDirection="column" marginTop={1}>
        <Text bold={!monochrome} {...(monochrome ? {} : {color: settings.colorTheme === 'high-contrast' ? '#FF5555' : pastelHealthColors.OVERDUE})}>This cannot be undone.</Text>
        <Confirmation
          text={`Delete "${modal.task.title}"?`}
          onAnswer={async confirmed => {
            if (confirmed) await service.delete(modal.task.id);
            setModal(null);
            setMessage(confirmed ? 'Task deleted' : 'Deletion cancelled');
            await reload();
          }}
        />
        <Text dimColor={!monochrome}>Press y to delete · n or Esc to cancel</Text>
      </Box>
    </ScreenPanel>;
  }
  if (modal?.kind === 'details') {
    const palette = screenPalette(settings);
    const monochrome = settings.monochrome || process.env.NO_COLOR !== undefined;
    const metrics = getMetrics(modal.task);
    return <ScreenPanel settings={settings} title="TASK DETAILS" height={screenHeight}>
      <Dismissible onClose={() => setModal(null)}>
        <Box borderStyle={settings.symbols === 'ascii' ? 'classic' : 'round'} {...(monochrome ? {} : {borderColor: palette.accent})} flexDirection="column" paddingX={1} width="100%">
          <Text bold={!monochrome} {...(monochrome ? {} : {color: palette.title})}>{modal.task.title}</Text>
          <Box><Text {...(monochrome ? {} : {color: palette.accent})}>Status: {modal.task.status}</Text><Text>  Priority: </Text><PriorityBadge priority={modal.task.priority} monochrome={monochrome} colors={settings.priorityColors} /></Box>
          <Text>Tracked: {formatDuration(metrics.effectiveTrackedMs)}    Effort left: {metrics.workLeftMs === null ? '—' : formatDuration(metrics.workLeftMs)}</Text>
          <Text>Deadline: {formatDeadline(modal.task.deadlineAt)}    Due in: {formatDueIn(modal.task, new Date())}</Text>
          <Text dimColor={!monochrome}>ID: {modal.task.id}</Text>
        </Box>
      </Dismissible>
    </ScreenPanel>;
  }
  if (modal?.kind === 'settings') return <SettingsPanel settings={settings} service={service} height={screenHeight} onClose={async () => { setModal(null); await reload(); }} />;
  return <Box flexDirection="column"><Dashboard tasks={tasks} settings={{...settings, monochrome: settings.monochrome || process.env.NO_COLOR !== undefined}} onAction={(name, task) => { void action(name, task); }} />{message && <Text>{message}</Text>}</Box>;
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

function Confirmation({text, onAnswer}: {text: string; onAnswer: (answer: boolean) => void | Promise<void>}) {
  useInput((input, key) => {
    if (input.toLocaleLowerCase() === 'y') void onAnswer(true);
    else if (input.toLocaleLowerCase() === 'n' || key.escape) void onAnswer(false);
  });
  return <Text>{text} [y/N]</Text>;
}

function Dismissible({onClose, children}: {onClose: () => void; children: React.ReactNode}) {
  useInput((_input, key) => { if (key.escape || key.return) onClose(); });
  return <Box flexDirection="column" width="100%">{children}<Text dimColor>Enter/Esc returns</Text></Box>;
}

function SettingsPanel({settings, service, height, onClose}: {settings: Settings; service: TodoService; height: number; onClose: () => void | Promise<void>}) {
  const [current, setCurrent] = useState(settings);
  const [editing, setEditing] = useState<{key: string; label: string} | null>(null);
  const [error, setError] = useState('');
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
    else if (input === 'p') void change('colorTheme', colorThemeIds[(colorThemeIds.indexOf(current.colorTheme) + 1) % colorThemeIds.length]!);
    else {
      const fields: Record<string, {key: string; label: string}> = {
        b: {key: 'borderColor', label: 'Border color (#RRGGBB or default)'},
        h: {key: 'titleColor', label: 'Heading color (#RRGGBB or default)'},
        a: {key: 'accentColor', label: 'Accent color (#RRGGBB or default)'},
        g: {key: 'selectedBackgroundColor', label: 'Selection background (#RRGGBB or default)'},
        x: {key: 'selectedTextColor', label: 'Selection text (#RRGGBB or default)'},
        v: {key: 'visibleColumns', label: 'Visible columns (comma separated)'}
      };
      if (fields[input]) { setError(''); setEditing(fields[input]); }
    }
  }, {isActive: editing === null});
  if (editing) return <ScreenPanel settings={current} title="EDIT SETTING" height={height}>
    <Box marginTop={1}>
      <TextPrompt label={editing.label} error={error} onCancel={() => { setEditing(null); setError(''); }} onSubmit={value => {
        void change(editing.key, value).then(() => { setEditing(null); setError(''); }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
      }} />
    </Box>
  </ScreenPanel>;
  const palette = screenPalette(current);
  const monochrome = current.monochrome || process.env.NO_COLOR !== undefined;
  return <ScreenPanel settings={current} title="Settings" height={11}>
    <Text>m monochrome: {String(current.monochrome)}</Text>
    <Text>u symbols: {current.symbols}</Text>
    <Text>t clock: {current.clock}</Text>
    <Text>c show completed: {String(current.showCompleted)}</Text>
    <Text>p theme: {themeLabels[current.colorTheme]} (press p to cycle)</Text>
    <Text {...(monochrome ? {} : {backgroundColor: palette.selectedBackground, color: palette.selectedText})}> Selected task preview </Text>
    <Text>b border: {current.borderColor ?? 'theme'}</Text>
    <Text>h heading: {current.titleColor ?? 'theme'}</Text>
    <Text>a accent: {current.accentColor ?? 'theme'}</Text>
    <Text>g selection background: {current.selectedBackgroundColor ?? 'theme'}</Text>
    <Text>x selection text: {current.selectedTextColor ?? 'theme'}</Text>
    <Text>v columns: {current.visibleColumns.join(',')}</Text>
    <Text dimColor={!monochrome}>Enter/Esc returns</Text>
  </ScreenPanel>;
}
