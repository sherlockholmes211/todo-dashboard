import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {colorThemeIds, defaultSettings, formatDuration, getMetrics, parseDuration, parsePriority, prioritySchema, sortTasks, taskSchema, type Health, type Priority, type Settings, type SortMode, type Task} from './domain.js';
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

export function TextPrompt({label, initial = '', error, replaceOnType = false, onSubmit, onCancel}: {
  label: string;
  initial?: string;
  error?: string;
  replaceOnType?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const firstInput = useRef(replaceOnType);
  const update = (next: string) => {
    valueRef.current = next;
    setValue(next);
  };
  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return) onSubmit(valueRef.current);
    else if (key.backspace || key.delete) { firstInput.current = false; update(valueRef.current.slice(0, -1)); }
    else if (!key.ctrl && !key.meta && input) {
      update(firstInput.current ? input : valueRef.current + input);
      firstInput.current = false;
    }
  });
  return <Box flexDirection="column"><Text>{label}</Text><Text>&gt; {value}█</Text>{error && <Text color="red">{error}</Text>}<Text dimColor>Enter confirms · Esc cancels</Text></Box>;
}

type ArrowDirection = 'left' | 'right';

function ArrowChoice({value, active}: {value: string; active: ArrowDirection | null}) {
  return <><Text inverse={active === 'left'}>{active === 'left' ? '[←]' : '←'}</Text> {value} <Text inverse={active === 'right'}>{active === 'right' ? '[→]' : '→'}</Text></>;
}

function PriorityPicker({initial, onSubmit, onCancel}: {initial: string; onSubmit: (value: string) => void; onCancel: () => void}) {
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const [active, setActive] = useState<ArrowDirection | null>(null);
  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (key.return) onSubmit(valueRef.current);
    else if (key.leftArrow || key.rightArrow) {
      const index = prioritySchema.options.indexOf(valueRef.current as Priority);
      const direction = key.rightArrow ? 1 : -1;
      const next = prioritySchema.options[(index + direction + prioritySchema.options.length) % prioritySchema.options.length]!;
      valueRef.current = next;
      setValue(next);
      setActive(key.rightArrow ? 'right' : 'left');
    }
  });
  return <Box flexDirection="column"><Text>Priority</Text><Text><ArrowChoice value={value} active={active} /></Text><Text dimColor>←/→ change · Enter confirms · Esc cancels</Text></Box>;
}

type EditableTaskField = 'title' | 'estimate' | 'priority' | 'date' | 'time' | 'description';
const editableTaskFields: {key: EditableTaskField; label: string}[] = [
  {key: 'title', label: 'Title'},
  {key: 'estimate', label: 'Estimate'},
  {key: 'priority', label: 'Priority'},
  {key: 'date', label: 'Deadline date'},
  {key: 'time', label: 'Deadline time'},
  {key: 'description', label: 'Description'}
];

function EditTaskForm({initial, settings, height, onSave, onCancel}: {
  initial: EditorModal;
  settings: Settings;
  height: number;
  onSave: (editor: EditorModal) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<EditableTaskField | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const palette = screenPalette(settings);
  const monochrome = settings.monochrome || process.env.NO_COLOR !== undefined;
  const activate = () => {
    setError('');
    if (selected === editableTaskFields.length) void save();
    else setEditing(editableTaskFields[selected]!.key);
  };
  const save = async () => {
    if (saving) return;
    if (form.time && !form.date) { setError('Choose a deadline date before setting a time'); return; }
    setSaving(true);
    try { await onSave(form); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); }
  };
  const submitField = (value: string) => {
    if (!editing) return;
    try {
      let next = value;
      if (editing === 'title') {
        const result = taskSchema.shape.title.safeParse(value);
        if (!result.success) throw new Error(result.error.issues[0]?.message ?? 'Invalid title');
        next = result.data;
      } else if (editing === 'estimate' && value) parseDuration(value);
      else if (editing === 'priority') next = parsePriority(value);
      else if (editing === 'date' && value && !isValidDate(value)) throw new Error('Enter a valid date as YYYY-MM-DD, or leave blank');
      else if (editing === 'time' && value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Enter time as HH:mm, or leave blank');
      setForm(current => ({...current, [editing]: next, ...(editing === 'date' && !next ? {time: ''} : {})}));
      setEditing(null);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.downArrow || input === 'j' || key.tab && !key.shift) setSelected(index => (index + 1) % (editableTaskFields.length + 1));
    else if (key.upArrow || input === 'k' || key.tab && key.shift) setSelected(index => (index + editableTaskFields.length) % (editableTaskFields.length + 1));
    else if (key.return) activate();
    else if (input === 's') void save();
  }, {isActive: editing === null});
  const renderEditor = (field: EditableTaskField) => {
    const common = {initial: form[field], error, onSubmit: submitField, onCancel: () => { setEditing(null); setError(''); }};
    if (field === 'date') return <DatePicker {...common} />;
    if (field === 'time') return <TimePicker {...common} />;
    if (field === 'priority') return <PriorityPicker {...common} />;
    return <TextPrompt {...common} label={editableTaskFields.find(item => item.key === field)!.label} replaceOnType />;
  };
  return <ScreenPanel settings={settings} title="EDIT TASK" height={height}>
    <Text {...(monochrome ? {} : {color: palette.accent})}>Choose a field to edit</Text>
    <Box flexDirection="column" marginTop={1}>
      {editableTaskFields.map(({key, label}, index) => <React.Fragment key={key}>
        <Text {...(selected === index && !monochrome ? {backgroundColor: palette.selectedBackground, color: palette.selectedText} : {})}>{selected === index ? settings.symbols === 'ascii' ? '>' : '›' : ' '} {label.padEnd(15)} {form[key] || '—'}</Text>
        {editing === key && <Box marginLeft={2} flexDirection="column">{renderEditor(key)}</Box>}
      </React.Fragment>)}
      <Text {...(selected === editableTaskFields.length && !monochrome ? {backgroundColor: palette.selectedBackground, color: palette.selectedText} : {})}>{selected === editableTaskFields.length ? settings.symbols === 'ascii' ? '>' : '›' : ' '} Save changes</Text>
    </Box>
    {error && !editing && <Text color="red">{error}</Text>}
    <Text dimColor={!monochrome}>↑/↓ or Tab navigate · Enter edit/select · s save · Esc cancel</Text>
  </ScreenPanel>;
}

function DatePicker({initial, error, onSubmit, onCancel}: {initial: string; error: string; onSubmit: (value: string) => void; onCancel: () => void}) {
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const updateDraft = (value: string) => { draftRef.current = value; setDraft(value); };
  const [cursor, setCursor] = useState(() => initial && isValidDate(initial) ? new Date(`${initial}T12:00:00`) : new Date());
  const [selected, setSelected] = useState(Boolean(initial));
  const validDraft = isValidDate(draft);
  const shown = validDraft ? new Date(`${draft}T12:00:00`) : cursor;
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const move = (days: number, months = 0) => {
    const base = validDraft ? shown : cursor;
    const next = months ? new Date(base.getFullYear(), base.getMonth() + months, Math.min(base.getDate(), new Date(base.getFullYear(), base.getMonth() + months + 1, 0).getDate())) : new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    setCursor(next);
    updateDraft('');
    setSelected(true);
  };
  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return) onSubmit(draftRef.current || (selected ? format(cursor) : ''));
    else if (key.leftArrow) move(-1);
    else if (key.rightArrow) move(1);
    else if (key.upArrow) move(-7);
    else if (key.downArrow) move(7);
    else if (input === '[') move(0, -1);
    else if (input === ']') move(0, 1);
    else if (input === 'x') { updateDraft(''); setSelected(false); }
    else if (key.backspace || key.delete) {
      updateDraft((draftRef.current || (selected ? format(cursor) : '')).slice(0, -1));
      setSelected(false);
    }
    else if (!key.ctrl && !key.meta && input) updateDraft(draftRef.current + input);
  });
  const first = new Date(shown.getFullYear(), shown.getMonth(), 1).getDay();
  const days = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();
  const rows = Array.from({length: Math.ceil((first + days) / 7)}, (_, week) => Array.from({length: 7}, (_, day) => {
    const number = week * 7 + day - first + 1;
    if (number < 1 || number > days) return '    ';
    return number === shown.getDate() && (selected || validDraft) ? `[${String(number).padStart(2, ' ')}]` : ` ${String(number).padStart(2, ' ')} `;
  }).join(''));
  return <Box flexDirection="column">
    <Text>Deadline date (YYYY-MM-DD; blank for none)</Text>
    <Text>&gt; {draft || (selected ? format(cursor) : '')}█</Text>
    <Text>{shown.toLocaleString('en-US', {month: 'long', year: 'numeric'})}</Text>
    <Text> Su  Mo  Tu  We  Th  Fr  Sa </Text>
    {rows.map((row, index) => <Text key={index}>{row}</Text>)}
    {error && <Text color="red">{error}</Text>}
    <Text dimColor>Type YYYY-MM-DD · Backspace edits · Arrows move · [ ] month · x clear · Enter select</Text>
  </Box>;
}

function TimePicker({initial, error, onSubmit, onCancel}: {initial: string; error: string; onSubmit: (value: string) => void; onCancel: () => void}) {
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const updateDraft = (value: string) => { draftRef.current = value; setDraft(value); };
  const [part, setPart] = useState<'hour' | 'minute'>('hour');
  const partRef = useRef<'hour' | 'minute'>('hour');
  const [picked, setPicked] = useState(Boolean(initial));
  const [time, setTime] = useState(() => initial || '00:00');
  const timeRef = useRef(initial || '00:00');
  const validDraft = /^([01]\d|2[0-3]):[0-5]\d$/.test(draft);
  const shown = validDraft ? draft : time;
  const adjust = (direction: number) => {
    const [hours, minutes] = (validDraft ? draft : timeRef.current).split(':').map(Number);
    const nextHours = partRef.current === 'hour' ? (hours! + direction + 24) % 24 : hours!;
    const nextMinutes = partRef.current === 'minute' ? (minutes! + direction + 60) % 60 : minutes!;
    const next = `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`;
    timeRef.current = next;
    setTime(next);
    updateDraft('');
    setPicked(true);
  };
  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return) onSubmit(draftRef.current || (picked ? timeRef.current : ''));
    else if (key.leftArrow) { partRef.current = 'hour'; setPart('hour'); }
    else if (key.rightArrow) { partRef.current = 'minute'; setPart('minute'); }
    else if (key.upArrow) adjust(1);
    else if (key.downArrow) adjust(-1);
    else if (input === 'x') { updateDraft(''); setPicked(false); }
    else if (key.backspace || key.delete) {
      updateDraft((draftRef.current || (picked ? timeRef.current : '')).slice(0, -1));
      setPicked(false);
    }
    else if (!key.ctrl && !key.meta && input) updateDraft(draftRef.current + input);
  });
  return <Box flexDirection="column">
    <Text>Deadline time (HH:mm; blank uses default)</Text>
    <Text>&gt; {draft || (picked ? time : '')}█</Text>
    <Text>Hours   Minutes</Text>
    <Text>{part === 'hour' ? '  ↓' : '          ↓'}</Text>
    <Text>{shown}</Text>
    {error && <Text color="red">{error}</Text>}
    <Text dimColor>Type HH:mm · Backspace edits · ←/→ part · ↑/↓ adjust · x default · Enter select</Text>
  </Box>;
}

export function Dashboard({tasks, settings: overrides, width: requestedWidth, now = () => new Date(), onAction}: DashboardProps) {
  const width = requestedWidth ?? process.stdout.columns ?? 80;
  const panelWidth: number | '100%' = requestedWidth === undefined ? '100%' : width;
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

  if (help) return <Box borderStyle={borderStyle} {...borderColor} flexDirection="column" paddingX={1} width={panelWidth}>
    <Text bold={!settings.monochrome} {...textColor(palette.title)}>Keyboard shortcuts</Text>
    <Text>j/k or arrows navigate · Enter details · n new · e edit · s start · p pause · P pause all</Text>
    <Text>c complete · r reopen · d delete · / search · o sort · , settings · ? help · q quit</Text>
  </Box>;

  const symbol = settings.symbols === 'ascii' ? '>' : '›';
  const wideWidths: Record<DashboardColumn, number> = {
    ...columnWidths, id: 9, state: 11, task: 23, tracked: 15, effortLeft: 14,
    deadline: 17, dueIn: 14, progress: Math.max(25, settings.progressBarWidth + 5),
    priority: 10, health: 17
  };
  const wideColumns: DashboardColumn[] = ['id', 'state', 'task', 'tracked', 'effortLeft', 'deadline', 'dueIn', 'priority', 'health'];
  const compactWideWidths = {...wideWidths, task: 18, tracked: 14, effortLeft: 13, dueIn: 13};
  const compactWideColumns = wideColumns.slice(1);
  const requiredWidth = (fields: DashboardColumn[], widths: Record<DashboardColumn, number>) => 6 + fields.reduce((total, field) => total + widths[field], 0) + 2 * (fields.length - 1);
  const fullWide = width >= requiredWidth(wideColumns, wideWidths);
  const layout = width >= requiredWidth(compactWideColumns, compactWideWidths) ? 'wide' : width >= 80 ? 'medium' : 'narrow';
  const showProgress = fullWide && width >= requiredWidth([...wideColumns.slice(0, 7), 'progress', ...wideColumns.slice(7)], wideWidths);
  const customColumns = settings.visibleColumns.join(',') !== defaultSettings.visibleColumns.join(',');
  const columns = settings.visibleColumns;
  const displayedColumns = customColumns ? columns : showProgress ? [...wideColumns.slice(0, 7), 'progress' as const, ...wideColumns.slice(7)] : fullWide ? wideColumns : compactWideColumns;
  const displayedWidths = customColumns ? {...columnWidths, progress: Math.max(columnWidths.progress, settings.progressBarWidth + 5)} : fullWide ? wideWidths : compactWideWidths;
  const selectedTime = now();
  const selectedWorkLeft = active ? getMetrics(active, selectedTime).workLeftMs : null;
  return <Box flexDirection="column" width={panelWidth}>
    <Box borderStyle={borderStyle} {...borderColor} flexDirection="column" paddingX={1} width={panelWidth}>
      <Text bold={!settings.monochrome} {...textColor(palette.title)}>TODO DASHBOARD</Text>
      <Text {...textColor(palette.accent)}>{visible.length} tasks · filter {filter} · sort {sort}{!searching && query ? ` · search: ${query}` : ''}</Text>
      {searching && <Text underline {...textColor(palette.accent)}>Search: {query}█</Text>}
    </Box>
    <Box marginTop={1} borderStyle={borderStyle} {...borderColor} flexDirection="column" paddingX={1} width={panelWidth}>
      <Text bold={!settings.monochrome} {...textColor(palette.title)}>TASKS</Text>
      {layout !== 'narrow' && <Text bold={!settings.monochrome} {...textColor(palette.accent)}>{customColumns || layout === 'wide' ? `  ${displayedColumns.map(column => columnLabels[column].padEnd(displayedWidths[column])).join('  ')}` : '  STATE       TASK                EFFORT LEFT  DUE IN       PRIORITY  HEALTH'}</Text>}
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
        if ((customColumns || layout === 'wide') && layout !== 'narrow') {
          const cells: Record<DashboardColumn, string> = {
            id: task.id.slice(0, 8), state, task: task.title, tracked: formatDuration(metrics.effectiveTrackedMs),
            effortLeft, deadline: formatDeadline(task.deadlineAt), dueIn,
            progress: progressBar(metrics.progress, settings.progressBarWidth, settings.symbols),
            priority: `[${task.priority.toUpperCase()}]`, health: metrics.health
          };
          const rowWidth = 2 + displayedColumns.reduce((total, column) => total + displayedWidths[column], 0) + 2 * (displayedColumns.length - 1);
          return <Text key={task.id} wrap="truncate-end" {...colored}>{selectedMarker} {displayedColumns.map((column, columnIndex) => <React.Fragment key={column}>
            {columnIndex > 0 && '  '}
            {column === 'priority'
              ? <><PriorityBadge priority={task.priority} monochrome={settings.monochrome} colors={settings.priorityColors} />{' '.repeat(Math.max(0, displayedWidths.priority - cells.priority.length))}</>
              : cells[column].slice(0, displayedWidths[column]).padEnd(displayedWidths[column])}
          </React.Fragment>)}{selected ? ' '.repeat(Math.max(0, width - 4 - rowWidth)) : ''}</Text>;
        }
        if (layout === 'narrow') return <Text key={task.id} {...colored}>{selectedMarker} {state === 'RUNNING' ? '*' : '-'} {task.title} <PriorityBadge priority={task.priority} monochrome={settings.monochrome} colors={settings.priorityColors} /> [{metrics.health}]</Text>;
        if (layout === 'medium') return <Text key={task.id} {...colored}>{selectedMarker} {state.padEnd(11)} {task.title.slice(0, 18).padEnd(19)} {effortLeft.padEnd(12)} {dueIn.padEnd(12)} <PriorityBadge priority={task.priority} monochrome={settings.monochrome} colors={settings.priorityColors} /> {metrics.health}</Text>;
        return null;
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
  step: 'title' | 'estimate' | 'priority' | 'date' | 'time' | 'description';
  task?: Task;
  title: string;
  description: string;
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
        setModal({kind: 'new', step: 'title', title: '', description: '', estimate: '', priority: 'medium', date: '', time: ''});
        return;
      } else if (name === 'edit' && task) {
        setEditorError('');
        const due = localDateParts(task.deadlineAt);
        setModal({kind: 'edit', step: 'title', task, title: task.title, description: task.description, estimate: task.estimateMs ? formatDuration(task.estimateMs) : '', priority: task.priority, ...due});
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
        setModal({...modal, date: '', time: '', step: 'description'});
      } else if (isValidDate(value)) setModal({...modal, date: value, step: 'time'});
      else setEditorError('Enter a valid date as YYYY-MM-DD, or leave blank');
    } else if (modal.step === 'time') {
      if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        setEditorError('Enter time as HH:mm, or leave blank');
        return;
      }
      setModal({...modal, time: value, step: 'description'});
    } else {
      const result = taskSchema.shape.description.safeParse(value);
      if (!result.success) setEditorError(result.error.issues[0]?.message ?? 'Invalid description');
      else {
        try { await saveEditor({...modal, description: result.data}); }
        catch (error) { setEditorError(error instanceof Error ? error.message : String(error)); }
      }
    }
  };

  const saveEditor = async (editor: EditorModal) => {
    const due = editor.date ? `${editor.date}${editor.time ? ` ${editor.time}` : ''}` : undefined;
    if (editor.kind === 'new') {
      await service.add(editor.title, {description: editor.description, priority: editor.priority, ...(editor.estimate ? {estimate: editor.estimate} : {}), ...(due ? {due} : {})});
    } else if (editor.task) {
      await service.edit(editor.task.id, {
        title: editor.title,
        description: editor.description,
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

  if (modal?.kind === 'edit') return <EditTaskForm initial={modal} settings={settings} height={screenHeight} onSave={saveEditor} onCancel={() => setModal(null)} />;
  if (modal?.kind === 'new') {
    const labels = {title: 'Task title', estimate: 'Estimate (for example 1h 30m; blank for none)', priority: 'Priority (low, medium, high, urgent)', date: 'Deadline date (YYYY-MM-DD; blank for none)', time: 'Deadline time (HH:mm; blank uses default)', description: 'Description (optional)'};
    const step = ['title', 'estimate', 'priority', 'date', 'time', 'description'].indexOf(modal.step) + 1;
    const monochrome = settings.monochrome || process.env.NO_COLOR !== undefined;
    return <ScreenPanel settings={settings} title="NEW TASK" height={screenHeight}>
      <Text {...(monochrome ? {} : {color: screenPalette(settings).accent})}>Step {step} of 6</Text>
      <Box marginTop={1}>
        {modal.step === 'date' ? <DatePicker key={`${modal.kind}-date`} initial={modal.date} error={editorError} onSubmit={value => { void submitEditor(value); }} onCancel={() => setModal(null)} />
          : modal.step === 'time' ? <TimePicker key={`${modal.kind}-time`} initial={modal.time} error={editorError} onSubmit={value => { void submitEditor(value); }} onCancel={() => setModal(null)} />
          : modal.step === 'priority' ? <PriorityPicker key={`${modal.kind}-priority`} initial={modal.priority} onSubmit={value => { void submitEditor(value); }} onCancel={() => setModal(null)} />
          : <TextPrompt
          key={`${modal.kind}-${modal.step}`}
          label={labels[modal.step]}
          initial={modal[modal.step]}
          error={editorError}
          onSubmit={value => { void submitEditor(value); }}
          onCancel={() => setModal(null)}
        />}
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
          <Box flexDirection={(process.stdout.columns ?? 80) < 80 ? 'column' : 'row'}>
            <Box flexDirection="column" width={(process.stdout.columns ?? 80) < 80 ? '100%' : '30%'}>
              <Text bold={!monochrome} {...(monochrome ? {} : {color: palette.accent})}>OVERVIEW</Text>
              <Text>Status: {modal.task.status}</Text>
              <Box><Text>Priority: </Text><PriorityBadge priority={modal.task.priority} monochrome={monochrome} colors={settings.priorityColors} /></Box>
              <Text>Health: {metrics.health}</Text>
            </Box>
            <Box flexDirection="column" width={(process.stdout.columns ?? 80) < 80 ? '100%' : '30%'}>
              <Text bold={!monochrome} {...(monochrome ? {} : {color: palette.accent})}>EFFORT</Text>
              <Text>Estimate: {modal.task.estimateMs === null ? '—' : formatDuration(modal.task.estimateMs)}</Text>
              <Text>Tracked: {formatDuration(metrics.effectiveTrackedMs)}</Text>
              <Text>Effort left: {metrics.workLeftMs === null ? '—' : formatDuration(metrics.workLeftMs)}</Text>
              <Text>Progress: {metrics.progress === null ? '—' : `${Math.round(metrics.progress * 100)}%`}</Text>
            </Box>
            <Box flexDirection="column" width={(process.stdout.columns ?? 80) < 80 ? '100%' : '40%'}>
              <Text bold={!monochrome} {...(monochrome ? {} : {color: palette.accent})}>SCHEDULE</Text>
              <Text>Deadline: {formatDeadline(modal.task.deadlineAt)}</Text>
              <Text>Due in: {formatDueIn(modal.task, new Date())}</Text>
            </Box>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text bold={!monochrome} {...(monochrome ? {} : {color: palette.accent})}>DESCRIPTION</Text>
            <Text>{modal.task.description || 'No description'}</Text>
          </Box>
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
  const [selected, setSelected] = useState(0);
  const [themeArrow, setThemeArrow] = useState<ArrowDirection | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [error, setError] = useState('');
  const change = async (key: string, value: string) => {
    const updated = await service.setConfig(key, value);
    setCurrent(updated);
  };
  const fields = [
    {shortcut: 'm', key: 'monochrome', label: 'monochrome', value: String(current.monochrome)},
    {shortcut: 'u', key: 'symbols', label: 'symbols', value: current.symbols},
    {shortcut: 't', key: 'clock', label: 'clock', value: current.clock},
    {shortcut: 'c', key: 'showCompleted', label: 'show completed', value: String(current.showCompleted)},
    {shortcut: 'p', key: 'colorTheme', label: 'theme', value: themeLabels[current.colorTheme]},
    {shortcut: 'b', key: 'borderColor', label: 'border', value: current.borderColor ?? 'theme'},
    {shortcut: 'h', key: 'titleColor', label: 'heading', value: current.titleColor ?? 'theme'},
    {shortcut: 'a', key: 'accentColor', label: 'accent', value: current.accentColor ?? 'theme'},
    {shortcut: 'g', key: 'selectedBackgroundColor', label: 'selection background', value: current.selectedBackgroundColor ?? 'theme'},
    {shortcut: 'x', key: 'selectedTextColor', label: 'selection text', value: current.selectedTextColor ?? 'theme'},
    {shortcut: 'v', key: 'visibleColumns', label: 'columns', value: current.visibleColumns.join(',')}
  ];
  const updateDraft = (value: string) => { draftRef.current = value; setDraft(value); };
  const activate = (index: number) => {
    const field = fields[index];
    if (!field) return;
    setSelected(index);
    setError('');
    if (field.key === 'monochrome') void change(field.key, String(!current.monochrome)).catch(cause => setError(String(cause)));
    else if (field.key === 'symbols') void change(field.key, current.symbols === 'unicode' ? 'ascii' : 'unicode').catch(cause => setError(String(cause)));
    else if (field.key === 'clock') void change(field.key, current.clock === '24h' ? '12h' : '24h').catch(cause => setError(String(cause)));
    else if (field.key === 'showCompleted') void change(field.key, String(!current.showCompleted)).catch(cause => setError(String(cause)));
    else if (field.key === 'colorTheme') { setThemeArrow('right'); void change(field.key, colorThemeIds[(colorThemeIds.indexOf(current.colorTheme) + 1) % colorThemeIds.length]!).catch(cause => setError(String(cause))); }
    else { updateDraft(''); setEditing(field.key); }
  };
  useInput((input, key) => {
    if (editing) {
      if (key.escape) { setEditing(null); setError(''); }
      else if (key.return) {
        void change(editing, draftRef.current).then(() => { setEditing(null); setError(''); }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
      } else if (key.backspace || key.delete) updateDraft(draftRef.current.slice(0, -1));
      else if (!key.ctrl && !key.meta && input) updateDraft(draftRef.current + input);
      return;
    }
    if (key.escape) void onClose();
    else if (key.downArrow || input === 'j') setSelected(value => Math.min(value + 1, fields.length - 1));
    else if (key.upArrow || input === 'k') setSelected(value => Math.max(value - 1, 0));
    else if ((key.leftArrow || key.rightArrow) && fields[selected]?.key === 'colorTheme') {
      const index = colorThemeIds.indexOf(current.colorTheme);
      setThemeArrow(key.rightArrow ? 'right' : 'left');
      void change('colorTheme', colorThemeIds[(index + (key.rightArrow ? 1 : -1) + colorThemeIds.length) % colorThemeIds.length]!).catch(cause => setError(String(cause)));
    }
    else if (key.return) activate(selected);
    else {
      const index = fields.findIndex(field => field.shortcut === input);
      if (index >= 0) activate(index);
    }
  });
  const palette = screenPalette(current);
  const monochrome = current.monochrome || process.env.NO_COLOR !== undefined;
  const borderStyle = current.symbols === 'ascii' ? 'classic' : 'round';
  const wide = (process.stdout.columns ?? 100) >= 78;
  const preview = <Box flexDirection="column" width={wide ? '50%' : '100%'}>
    <Text bold={!monochrome} {...(monochrome ? {} : {color: palette.title})}>PREVIEW</Text>
    <Box borderStyle={borderStyle} {...(monochrome ? {} : {borderColor: palette.border})} flexDirection="column" paddingX={1} width="100%">
      <Text bold={!monochrome} {...(monochrome ? {} : {color: palette.title})}>TODO DASHBOARD</Text>
      <Text {...(monochrome ? {} : {color: palette.accent})}>2 tasks · filter all · sort created</Text>
    </Box>
    <Box marginTop={1} borderStyle={borderStyle} {...(monochrome ? {} : {borderColor: palette.border})} flexDirection="column" paddingX={1} width="100%">
      <Text bold={!monochrome} {...(monochrome ? {} : {color: palette.title})}>TASKS</Text>
      <Text {...(monochrome ? {} : {backgroundColor: palette.selectedBackground, color: palette.selectedText})}>{current.symbols === 'ascii' ? '>' : '›'} - Plan release [HIGH] [ON TRACK]</Text>
      <Text>  - Review notes [LOW] [UNKNOWN]</Text>
    </Box>
    <Text dimColor={!monochrome}>j/k navigate · Enter details</Text>
  </Box>;
  return <ScreenPanel settings={current} title="Settings" height={height}>
    <Box flexDirection={wide ? 'row' : 'column'}>
      <Box flexDirection="column" width={wide ? '50%' : '100%'} flexShrink={0}>
        {fields.map((field, index) => <Text key={field.key} wrap="truncate-end" {...(index === selected && !monochrome ? {color: palette.accent} : {})}>
          {index === selected ? current.symbols === 'ascii' ? '>' : '›' : ' '} {field.shortcut} {editing === field.key ? `${field.label === 'columns' ? 'Visible columns' : `${field.label.charAt(0).toUpperCase()}${field.label.slice(1)} color`}: > ${draft}█` : field.key === 'colorTheme' ? <>theme: <ArrowChoice value={field.value} active={themeArrow} /></> : `${field.label}: ${field.value}`}
        </Text>)}
        {error && <Text color="red" wrap="truncate-end">{error}</Text>}
        <Text dimColor={!monochrome}>↑/↓ rows · ←/→ theme · Enter · Esc {editing ? 'cancel' : 'back'}</Text>
        {editing && <Text dimColor={!monochrome}>#RRGGBB or default · Enter saves</Text>}
      </Box>
      {preview}
    </Box>
  </ScreenPanel>;
}
