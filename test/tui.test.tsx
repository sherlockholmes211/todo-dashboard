import React from 'react';
import {mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripVTControlCharacters} from 'node:util';
import {render} from 'ink-testing-library';
import {describe, expect, it, vi} from 'vitest';
import {createTask, startTask, type Settings} from '../src/domain.js';
import {Dashboard, TextPrompt} from '../src/tui.js';
import {TodoApp} from '../src/tui.js';
import {TodoService} from '../src/service.js';
import {StoreRepository} from '../src/storage.js';

const inkRequire = createRequire(import.meta.resolve('ink'));
const inkChalk = (await import(pathToFileURL(inkRequire.resolve('chalk')).href) as {default: {level: number}}).default;

const now = new Date('2026-09-20T10:00:00.000Z');
const tasks = [
  createTask({title: 'First task', estimateMs: 3_600_000}, now, '00000000-0000-4000-8000-000000000001'),
  startTask(createTask({title: 'Second task'}, now, '00000000-0000-4000-8000-000000000002'), now)
];

describe('Dashboard', () => {
  it.each([
    {theme: 'lavender-dusk', border: '169;154;200', heading: '229;221;243', accent: '171;216;202', selection: '55;51;72'},
    {theme: 'sage-cream', border: '147;179;165', heading: '225;233;218', accent: '184;213;188', selection: '48;69;60'},
    {theme: 'misty-blue', border: '156;183;207', heading: '221;232;242', accent: '230;190;168', selection: '48;67;87'},
    {theme: 'rose-slate', border: '190;155;174', heading: '240;220;229', accent: '169;199;212', selection: '70;55;70'},
    {theme: 'soft-amber', border: '188;169;132', heading: '240;224;190', accent: '180;209;195', selection: '70;62;49'},
    {theme: 'quiet-monochrome', border: '133;139;151', heading: '228;230;234', accent: '180;187;197', selection: '52;57;65'}
  ])('renders the $theme palette on the dashboard', ({theme, border, heading, accent, selection}) => {
    const originalLevel = inkChalk.level;
    inkChalk.level = 3;
    try {
      const task = createTask({title: 'Ship release'}, now);
      const view = render(<Dashboard tasks={[task]} settings={{colorTheme: theme as Settings['colorTheme']}} width={100} now={() => now} />);
      const frame = view.lastFrame() ?? '';
      expect(frame).toContain(`\u001b[38;2;${border}m╭`);
      expect(frame).toContain(`\u001b[38;2;${heading}mTODO DASHBOARD`);
      expect(frame).toContain(`\u001b[38;2;${accent}m1 tasks`);
      expect(frame).toContain(`\u001b[48;2;${selection}m`);
      expect(frame).toContain('\u001b[38;2;247;244;242m');
    } finally {
      inkChalk.level = originalLevel;
    }
  });

  it('uses configured panel, heading, accent, and priority colors', () => {
    const originalLevel = inkChalk.level;
    inkChalk.level = 3;
    try {
      const task = createTask({title: 'Ship release', priority: 'high'}, now);
      const view = render(<Dashboard tasks={[task]} width={150} now={() => now} settings={{borderColor: '#123456', titleColor: '#234567', accentColor: '#345678', priorityColors: {low: '#86EFAC', medium: '#93C5FD', high: '#456789', urgent: '#FDA4AF'}}} />);
      const frame = view.lastFrame() ?? '';
      expect(frame).toContain('\u001b[38;2;18;52;86m');
      expect(frame).toContain('\u001b[38;2;35;69;103mTODO DASHBOARD');
      expect(frame).toContain('\u001b[38;2;52;86;120m');
      expect(frame).toContain('\u001b[38;2;69;103;137m[HIGH]');
    } finally { inkChalk.level = originalLevel; }
  });

  it('shows only configured columns in the requested order', () => {
    const task = createTask({title: 'Pay bill', deadlineAt: '2026-09-20T12:00:00.000Z'}, now);
    const view = render(<Dashboard tasks={[task]} width={180} now={() => now} settings={{visibleColumns: ['task', 'dueIn', 'priority']}} />);
    const frame = view.lastFrame() ?? '';
    expect(frame).toMatch(/TASK\s+DUE IN\s+PRIORITY/);
    expect(frame).toContain('Pay bill');
    expect(frame).toContain('2h');
    expect(frame).toContain('[MEDIUM]');
    expect(frame).not.toContain('EFFORT LEFT');
    expect(frame).not.toContain('HEALTH');
    expect(frame).not.toContain('STATE');
  });

  it('separates progress, priority, and health in customized columns', () => {
    const task = createTask({title: 'Ship release'}, now);
    const view = render(<Dashboard tasks={[task]} width={180} now={() => now} settings={{visibleColumns: ['progress', 'priority', 'health']}} />);
    const frame = view.lastFrame() ?? '';
    expect(frame).toMatch(/PROGRESS\s{21,}PRIORITY\s{2,}HEALTH/);
    expect(frame).toMatch(/\[MEDIUM\]\s{5,}UNKNOWN/);
  });

  it('keeps wide dashboard columns aligned when durations grow', () => {
    const task = {
      ...createTask({title: 'Prepare a long release', priority: 'high', estimateMs: 12 * 86_400_000, deadlineAt: '2027-10-10T10:00:00.000Z'}, now),
      trackedMs: 2 * 86_400_000 + 20 * 3_600_000 + 44 * 60_000
    };
    const view = render(<Dashboard tasks={[task]} width={210} now={() => now} settings={{symbols: 'ascii'}} />);
    const lines = stripVTControlCharacters(view.lastFrame() ?? '').split('\n');
    const heading = lines.find(line => line.includes('PROGRESS')) ?? '';
    const row = lines.find(line => line.includes('Prepare a long release')) ?? '';
    expect(row.indexOf('2d 20h 44m')).toBe(heading.indexOf('TRACKED'));
    expect(row.indexOf('#')).toBe(heading.indexOf('PROGRESS'));
    expect(row.indexOf('[HIGH]')).toBe(heading.indexOf('PRIORITY'));
    expect(row.indexOf('ON TRACK')).toBe(heading.indexOf('HEALTH'));
  });

  it('highlights the selected dashboard row continuously across gaps and priority', () => {
    const originalLevel = inkChalk.level;
    const originalNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    inkChalk.level = 3;
    try {
      const task = createTask({title: 'Plan release', priority: 'high'}, now);
      const view = render(<Dashboard tasks={[task]} width={210} now={() => now} />);
      const line = (view.lastFrame() ?? '').split('\n').find(row => row.includes('Plan release')) ?? '';
      const escape = String.fromCharCode(27);
      let visible = '';
      let highlighted = false;
      const backgroundByColumn: boolean[] = [];
      for (let index = 0; index < line.length;) {
        if (line[index] === escape) {
          const end = line.indexOf('m', index);
          const codes = line.slice(index + 2, end).split(';');
          if (codes[0] === '0' || codes[0] === '49') highlighted = false;
          if (codes.join(';').includes('48;2;237;233;254')) highlighted = true;
          index = end + 1;
        } else {
          visible += line[index];
          backgroundByColumn.push(highlighted);
          index++;
        }
      }
      const first = visible.indexOf('›');
      const last = visible.lastIndexOf('│') - 1;
      expect(first).toBeGreaterThanOrEqual(0);
      const gaps = backgroundByColumn.slice(first, last).flatMap((painted, index) => painted ? [] : [`${first + index}:${JSON.stringify(visible[first + index])}`]);
      expect(gaps).toEqual([]);
    } finally {
      inkChalk.level = originalLevel;
      if (originalNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = originalNoColor;
    }
  });

  it('honors the visible column list on narrow terminals', () => {
    const task = createTask({title: 'Pay bill', deadlineAt: '2026-09-20T12:00:00.000Z'}, now);
    const view = render(<Dashboard tasks={[task]} width={40} now={() => now} settings={{visibleColumns: ['task', 'dueIn']}} />);
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Pay bill');
    expect(frame).toContain('2h');
    expect(frame).not.toContain('[MEDIUM]');
    expect(frame).not.toContain('UNKNOWN');
    expect(frame).not.toContain('effort left');
  });
  it('shows a color coded priority badge in its own column', () => {
    const originalLevel = inkChalk.level;
    inkChalk.level = 3;
    try {
      const task = createTask({title: 'Ship release', priority: 'high'}, now);
      const view = render(<Dashboard tasks={[task]} width={150} now={() => now} />);
      const frame = view.lastFrame() ?? '';
      expect(frame).toContain('PRIORITY');
      expect(frame).toContain('[HIGH]');
      expect(frame).toMatch(/\[38;2;[^m]+m\[HIGH\]/);
    } finally {
      inkChalk.level = originalLevel;
    }
  });

  it('uses separate rounded panels, pastel accents, and a highlighted selection', () => {
    const originalLevel = inkChalk.level;
    inkChalk.level = 3;
    try {
      const view = render(<Dashboard tasks={tasks} width={100} now={() => now} />);
      const frame = view.lastFrame() ?? '';
      expect((frame.match(/╭/g) ?? []).length).toBeGreaterThanOrEqual(2);
      expect(frame).toContain('TODO DASHBOARD');
      expect(frame).toContain('TASKS');
      const escape = String.fromCharCode(27);
      expect(frame).toContain(`${escape}[38;2;`);
      expect(frame).toContain(`${escape}[48;2;`);
      const unselectedTaskLine = frame.split('\n').find(line => line.includes('Second task')) ?? '';
      const beforeUnselectedState = (unselectedTaskLine.split('│')[1] ?? '').split('RUNNING')[0] ?? '';
      expect(beforeUnselectedState).toContain(`${escape}[38;2;`);
    } finally {
      inkChalk.level = originalLevel;
    }
  });

  it('uses ASCII borders without escape codes in monochrome mode', () => {
    const originalLevel = inkChalk.level;
    inkChalk.level = 3;
    try {
      const view = render(<Dashboard tasks={tasks} settings={{monochrome: true, symbols: 'ascii'}} width={80} now={() => now} />);
      const frame = view.lastFrame() ?? '';
      expect((frame.match(/\+-+/g) ?? []).length).toBeGreaterThanOrEqual(2);
      expect(frame).toContain('First task');
      expect(frame).not.toContain('\u001b[');
    } finally {
      inkChalk.level = originalLevel;
    }
  });

  it('keeps the help screen inside a distinct bordered panel', async () => {
    const view = render(<Dashboard tasks={tasks} width={100} now={() => now} />);
    view.stdin.write('?');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Keyboard shortcuts'));
    expect(view.lastFrame()).toContain('╭');
    expect(view.lastFrame()).toContain('╰');
  });

  it('shows the settings shortcut in the home-screen footer', () => {
    const view = render(<Dashboard tasks={tasks} width={100} now={() => now} />);
    expect(view.lastFrame()).toContain(', settings');
  });

  it('shows search entry and exit shortcuts in the footer', async () => {
    const view = render(<Dashboard tasks={tasks} width={100} now={() => now} />);
    expect(view.lastFrame()).toContain('/ search');
    view.stdin.write('/');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Enter/Esc exit search'));
  });

  it('shows an underlined empty search input immediately on slash', async () => {
    const originalLevel = inkChalk.level;
    const originalNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    inkChalk.level = 3;
    const view = render(<Dashboard tasks={tasks} width={100} now={() => now} />);
    try {
      view.stdin.write('/');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Search: █'));
      const frame = view.lastFrame() ?? '';
      const searchLine = frame.split('\n').find(line => line.includes('Search:')) ?? '';
      expect(searchLine).toContain('\u001b[4m');
      expect(frame).not.toContain('sort created█');
    } finally {
      view.unmount();
      inkChalk.level = originalLevel;
      if (originalNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = originalNoColor;
    }
  });

  it('renders a plain adaptive task view with text health and no ANSI when monochrome', () => {
    const view = render(<Dashboard tasks={tasks} settings={{monochrome: true, symbols: 'ascii'}} width={120} now={() => now} />);
    expect(view.lastFrame()).toContain('TODO DASHBOARD');
    expect(view.lastFrame()).toContain('First task');
    expect(view.lastFrame()).toContain('UNKNOWN');
    expect(view.lastFrame()).not.toContain(String.fromCharCode(27));
  });

  it('shows effort remaining separately from the deadline and its countdown', () => {
    const deadlineAt = '2026-09-21T13:00:00.000Z';
    const task = {...createTask({title: 'Ship release', estimateMs: 14_400_000, deadlineAt}, now), trackedMs: 3_600_000};
    const view = render(<Dashboard tasks={[task]} width={140} now={() => now} />);
    Object.defineProperty(view.stdout, 'columns', {value: 140, configurable: true});
    view.stdout.emit('resize');
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('EFFORT LEFT');
    expect(frame).toContain('DEADLINE');
    expect(frame).toContain('DUE IN');
    expect(frame).toContain('3h');
    expect(frame).toContain('1d 3h');
  });

  it('retains progress when the terminal is wide enough for all timing columns', () => {
    const task = {...createTask({title: 'Ship release', estimateMs: 14_400_000, deadlineAt: '2026-09-21T13:00:00.000Z'}, now), trackedMs: 3_600_000};
    const view = render(<Dashboard tasks={[task]} width={180} now={() => now} />);
    Object.defineProperty(view.stdout, 'columns', {value: 180, configurable: true});
    view.stdout.emit('resize');
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('PROGRESS');
    expect(frame).toContain('25%');
    expect(frame).toContain('DUE IN');
  });

  it('shows the deadline countdown even when a task has no effort estimate on medium terminals', () => {
    const task = createTask({title: 'Pay bill', deadlineAt: '2026-09-20T12:00:00.000Z'}, now);
    const view = render(<Dashboard tasks={[task]} width={100} now={() => now} />);
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('EFFORT LEFT');
    expect(frame).toContain('DUE IN');
    expect(frame).toMatch(/Pay bill\s+—\s+2h/);
  });

  it('keeps both timing values accessible for the selected task on narrow terminals', () => {
    const task = createTask({title: 'Pay bill', estimateMs: 3_600_000, deadlineAt: '2026-09-20T12:00:00.000Z'}, now);
    const view = render(<Dashboard tasks={[task]} width={40} now={() => now} />);
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('effort left 1h');
    expect(frame).toContain('due in 2h');
  });

  it('uses a compact layout on narrow terminals', () => {
    const view = render(<Dashboard tasks={tasks} width={40} now={() => now} />);
    expect(view.lastFrame()).toContain('First task');
    expect(view.lastFrame()).toContain('Selected:');
    expect(view.lastFrame()).not.toContain('WORK LEFT');
  });

  it('supports vim navigation, help, and task action keys', async () => {
    const onAction = vi.fn();
    const view = render(<Dashboard tasks={tasks} width={80} now={() => now} onAction={onAction} />);
    view.stdin.write('j');
    await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› RUNNING\s+Second task/));
    view.stdin.write('s');
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledWith('start', tasks[1]));
    view.stdin.write('?');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Keyboard shortcuts'));
  });

  it('cycles task filters with f', async () => {
    const view = render(<Dashboard tasks={tasks} width={80} now={() => now} />);
    view.stdin.write('f');
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain('First task');
      expect(view.lastFrame()).not.toContain('Second task');
    });
  });

  it('captures text in interactive forms and submits on enter', async () => {
    const submit = vi.fn();
    const view = render(<TextPrompt label="Task title" onSubmit={submit} onCancel={() => undefined} />);
    view.stdin.write('Ship it');
    view.stdin.write('\r');
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith('Ship it'));
  });
});

describe('task editor deadline', () => {
  it('rejects a blank task title before moving to later steps', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-title-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No tasks'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task title'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Title is required'));
      expect(view.lastFrame()).toContain('Task title');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('rejects an invalid estimate at its own step so the final time can save', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-estimate-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No tasks'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task title'));
      view.stdin.write('Plan release');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Estimate'));
      view.stdin.write('two hours');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('positive duration'));
      expect(view.lastFrame()).toContain('Estimate');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('creates a task after entering a deadline time in HH:mm format', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-time-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No tasks'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task title'));
      view.stdin.write('Plan release');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Estimate'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Priority'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Su  Mo  Tu  We  Th  Fr  Sa'));
      await new Promise<void>(resolve => setImmediate(resolve));
      view.stdin.write('2026-10-10');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('> 2026-10-10'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Deadline time'));
      view.stdin.write('20:10');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Description (optional)'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task created'));
      const task = (await service.list())[0];
      expect(task?.deadlineAt).not.toBeNull();
      expect(new Date(task!.deadlineAt!).getHours()).toBe(20);
      expect(new Date(task!.deadlineAt!).getMinutes()).toBe(10);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('selects a deadline date and time with the keyboard pickers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-pickers-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No tasks'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task title'));
      view.stdin.write('Plan release');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Estimate'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Priority'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Su  Mo  Tu  We  Th  Fr  Sa'));
      expect(view.lastFrame()).toContain('Su  Mo  Tu  We  Th  Fr  Sa');
      view.stdin.write('2026-10-10');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('2026-10-10'));
      view.stdin.write('\u001b[C');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('2026-10-11'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Deadline time'));
      expect(view.lastFrame()).toContain('Hours');
      expect(view.lastFrame()).toContain('Minutes');
      view.stdin.write('\u001b[A');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('01:00'));
      view.stdin.write('\u001b[C');
      view.stdin.write('\u001b[A');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('01:01'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Description (optional)'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task created'));
      const task = (await service.list())[0];
      const due = new Date(task!.deadlineAt!);
      expect([due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getHours(), due.getMinutes()]).toEqual([2026, 10, 11, 1, 1]);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('updates an existing deadline with the date and time pickers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-edit-pickers-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Plan release', {due: '2026-10-10 20:10'});
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Plan release'));
      view.stdin.write('e');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('EDIT TASK'));
      await new Promise<void>(resolve => setImmediate(resolve));
      for (const field of ['Estimate', 'Priority', 'Deadline date']) {
        view.stdin.write('\u001b[B');
        await vi.waitFor(() => expect(view.lastFrame()).toMatch(new RegExp(`› ${field}`)));
      }
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Su  Mo  Tu  We  Th  Fr  Sa'));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(view.lastFrame()).toContain('2026-10-10');
      view.stdin.write('\u001b[C');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('2026-10-11'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Su  Mo  Tu  We  Th  Fr  Sa'));
      view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› Deadline time/));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Hours'));
      expect(view.lastFrame()).toContain('20:10');
      view.stdin.write('\u001b[C');
      view.stdin.write('\u001b[A');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('20:11'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Hours   Minutes'));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task updated'));
      const task = (await service.list())[0];
      const due = new Date(task!.deadlineAt!);
      expect([due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getHours(), due.getMinutes()]).toEqual([2026, 10, 11, 20, 11]);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('opens a navigable edit form and saves only the selected field change', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-edit-form-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Plan release', {estimate: '2h', due: '2026-10-10 20:10'});
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Plan release'));
      view.stdin.write('e');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('EDIT TASK'));
      const form = view.lastFrame() ?? '';
      expect(form).toContain('Title');
      expect(form).toContain('Estimate');
      expect(form).toContain('Priority');
      expect(form).toContain('Deadline date');
      expect(form).toContain('Deadline time');
      expect(form).toContain('Save changes');
      expect(form).not.toContain('Step 1 of 5');
      for (let index = 0; index < 4; index++) view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› Deadline time/));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Hours'));
      await new Promise<void>(resolve => setImmediate(resolve));
      view.stdin.write('09:35');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Hours   Minutes'));
      const beforeSave = new Date((await service.list())[0]!.deadlineAt!);
      expect([beforeSave.getHours(), beforeSave.getMinutes()]).toEqual([20, 10]);
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task updated'));
      const task = (await service.list())[0]!;
      const due = new Date(task.deadlineAt!);
      expect([task.title, task.estimateMs, due.getHours(), due.getMinutes()]).toEqual(['Plan release', 7_200_000, 9, 35]);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('replaces title, estimate, and priority directly in the edit form', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-edit-fields-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Plan release', {estimate: '2h', priority: 'medium'});
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Plan release'));
      view.stdin.write('e');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('EDIT TASK'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('> Plan release'));
      view.stdin.write('Revised release');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('> Revised release'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Enter confirms'));
      view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› Estimate/));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('> 2h'));
      view.stdin.write('3h');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('> 3h'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Enter confirms'));
      view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› Priority/));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← medium →'));
      view.stdin.write('urgent');
      expect(view.lastFrame()).toContain('← medium →');
      view.stdin.write('\u001b[C');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← high [→]'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Enter confirms'));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task updated'));
      expect((await service.list())[0]).toMatchObject({title: 'Revised release', estimateMs: 10_800_000, priority: 'high'});
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('changes priority with arrow keys while editing a task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-edit-priority-arrows-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Plan release', {priority: 'medium'});
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Plan release'));
      await new Promise<void>(resolve => setImmediate(resolve));
      view.stdin.write('e');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('EDIT TASK'));
      await new Promise<void>(resolve => setImmediate(resolve));
      view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› Estimate/));
      view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› Priority/));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← medium →'));
      view.stdin.write('\u001b[C');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← high [→]'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› Priority\s+high/));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task updated'));
      expect((await service.list())[0]?.priority).toBe('high');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('replaces an existing deadline by typing in both picker inputs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-edit-deadline-text-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Plan release', {due: '2026-10-10 20:10'});
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Plan release'));
      await new Promise<void>(resolve => setImmediate(resolve));
      view.stdin.write('e');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('EDIT TASK'));
      await new Promise<void>(resolve => setImmediate(resolve));
      for (const field of ['Estimate', 'Priority', 'Deadline date']) {
        view.stdin.write('\u001b[B');
        await vi.waitFor(() => expect(view.lastFrame()).toMatch(new RegExp(`› ${field}`)));
      }
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Su  Mo  Tu  We  Th  Fr  Sa'));
      await new Promise<void>(resolve => setImmediate(resolve));
      view.stdin.write('2026-11-15');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('> 2026-11-15'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Su  Mo  Tu  We  Th  Fr  Sa'));
      view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› Deadline time/));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Hours'));
      await new Promise<void>(resolve => setImmediate(resolve));
      view.stdin.write('09:35');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('> 09:35'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Hours   Minutes'));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task updated'));
      const due = new Date((await service.list())[0]!.deadlineAt!);
      expect([due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getHours(), due.getMinutes()]).toEqual([2026, 11, 15, 9, 35]);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('edits border color and visible columns from settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-settings-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('TODO DASHBOARD'));
      view.stdin.write(',');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Settings'));
      view.stdin.write('b');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Border color'));
      view.stdin.write('#123456');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Border color: > #123456'));
      view.stdin.write('\r');
      await vi.waitFor(() => {
        expect(view.lastFrame()).toContain('Settings');
        expect(view.lastFrame()).toContain('border: #123456');
        expect(view.lastFrame()).not.toContain('Border color: >');
      });
      view.stdin.write('v');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Visible columns'));
      view.stdin.write('task,dueIn');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Visible columns: > task,dueIn'));
      view.stdin.write('\r');
      await vi.waitFor(async () => expect(await service.getConfig('visibleColumns')).toEqual(['task', 'dueIn']));
      expect(await service.getConfig('borderColor')).toBe('#123456');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('moves through settings with arrows and activates the selected row', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-settings-nav-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('TODO DASHBOARD'));
      view.stdin.write(',');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› m monochrome:/));
      view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› u symbols:/));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('u symbols: ascii'));
      expect(await service.getConfig('symbols')).toBe('ascii');
      view.stdin.write('\u001b[A');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/> m monochrome:/));
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('edits a color inline and updates the adjacent task preview', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-settings-inline-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const originalLevel = inkChalk.level;
    const originalNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    inkChalk.level = 3;
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('TODO DASHBOARD'));
      view.stdin.write(',');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Settings'));
      expect(view.lastFrame()).toContain('PREVIEW');
      expect(view.lastFrame()).toContain('Plan release');
      expect(view.lastFrame()).not.toContain('Selected task preview');
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Selection background color: >'));
      expect(view.lastFrame()).toContain('PREVIEW');
      view.stdin.write('#123456');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('selection background: #123456'));
      expect(view.lastFrame()).toContain('\u001b[48;2;18;52;86m');
      expect(await service.getConfig('selectedBackgroundColor')).toBe('#123456');
    } finally {
      view.unmount();
      inkChalk.level = originalLevel;
      if (originalNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = originalNoColor;
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('gives the preview half the settings content and two dashboard panels', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-preview-layout-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('TODO DASHBOARD'));
      view.stdin.write(',');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('PREVIEW'));
      const lines = stripVTControlCharacters(view.lastFrame() ?? '').split('\n');
      const outerWidth = lines[0]!.length;
      const previewStart = 2 + Math.floor((outerWidth - 4) / 2);
      const panelTops = lines.filter(line => line.includes('╭') && !line.startsWith('╭'));
      expect(panelTops).toHaveLength(2);
      for (const line of panelTops) {
        expect(line.indexOf('╭')).toBe(previewStart);
        expect(line.indexOf('╮')).toBe(outerWidth - 3);
      }
      expect(lines.some(line => line.includes('TODO DASHBOARD') && line.includes('│'))).toBe(true);
      expect(lines.some(line => line.includes('TASKS') && line.includes('│'))).toBe(true);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('cycles and saves named color themes from settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-theme-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('TODO DASHBOARD'));
      view.stdin.write(',');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Settings'));
      view.stdin.write('p');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← Lavender dusk [→]'));
      expect(await service.getConfig('colorTheme')).toBe('lavender-dusk');
      view.stdin.write('p');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← Sage & cream [→]'));
      expect(await service.getConfig('colorTheme')).toBe('sage-cream');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('changes the selected theme in either direction with arrow keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-theme-arrows-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('TODO DASHBOARD'));
      view.stdin.write(',');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Settings'));
      for (let index = 0; index < 4; index++) view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› p theme: ← Default →/));
      view.stdin.write('\u001b[D');
      await vi.waitFor(async () => expect(await service.getConfig('colorTheme')).toBe('high-contrast'));
      expect(view.lastFrame()).toContain('[←] High contrast →');
      view.stdin.write('\u001b[C');
      await vi.waitFor(async () => expect(await service.getConfig('colorTheme')).toBe('default'));
      expect(view.lastFrame()).toContain('← Default [→]');
      view.stdin.write('\u001b[C');
      await vi.waitFor(async () => expect(await service.getConfig('colorTheme')).toBe('lavender-dusk'));
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('previews the selected theme inside settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-theme-preview-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const originalLevel = inkChalk.level;
    const originalNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    inkChalk.level = 3;
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('TODO DASHBOARD'));
      view.stdin.write(',');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Settings'));
      view.stdin.write('p');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Lavender dusk'));
      const frame = view.lastFrame() ?? '';
      expect(frame).toContain('\u001b[38;2;169;154;200m╭');
      expect(frame).toContain('\u001b[48;2;55;51;72m');
    } finally {
      view.unmount();
      inkChalk.level = originalLevel;
      if (originalNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = originalNoColor;
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('sets a task priority during creation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-priority-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No tasks'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task title'));
      view.stdin.write('Ship release');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Estimate'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Priority'));
      view.stdin.write('urgent');
      expect(view.lastFrame()).toContain('← medium →');
      view.stdin.write('\u001b[C');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← high [→]'));
      view.stdin.write('\u001b[C');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← urgent [→]'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Deadline date'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Description (optional)'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task created'));
      expect((await service.list())[0]?.priority).toBe('urgent');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('cycles priority in both directions during task creation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-priority-arrows-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No tasks'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task title'));
      view.stdin.write('Ship release');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Estimate'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← medium →'));
      view.stdin.write('\u001b[C');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('← high [→]'));
      view.stdin.write('\u001b[D');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('[←] medium →'));
      view.stdin.write('\u001b[D');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('[←] low →'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Deadline date'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Description (optional)'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task created'));
      expect((await service.list())[0]?.priority).toBe('low');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('keeps an invalid date editable and lets a blank date create a task without a deadline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-test-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No tasks'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task title'));
      view.stdin.write('Write docs');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Estimate'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Priority'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Deadline date'));
      view.stdin.write('wrong');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Enter a valid date'));
      expect(view.lastFrame()).toContain('wrong');
      for (let index = 0; index < 5; index++) view.stdin.write('\b');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Description (optional)'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task created'));
      expect((await service.list())[0]).toMatchObject({title: 'Write docs', deadlineAt: null});
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });
});

describe('task screen layout', () => {
  it('keeps appearance editing inside the same rounded frame', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-appearance-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('TODO DASHBOARD'));
      const dashboardFrame = view.lastFrame() ?? '';
      const dashboardHeight = dashboardFrame.split('\n').length;
      const dashboardWidth = dashboardFrame.split('\n').find(line => line.startsWith('╭'))?.length;
      view.stdin.write(',');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Settings'));
      view.stdin.write('b');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Border color'));
      const frame = view.lastFrame() ?? '';
      expect(frame).toContain('╭');
      expect(frame).toContain('╰');
      expect(frame.split('\n').length).toBeGreaterThanOrEqual(dashboardHeight);
      expect(frame.split('\n').find(line => line.startsWith('╭'))?.length).toBe(dashboardWidth);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('frames delete confirmation at dashboard width and height with a warning', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-delete-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Write docs');
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Write docs'));
      const dashboardFrame = view.lastFrame() ?? '';
      const dashboardHeight = dashboardFrame.split('\n').length;
      const dashboardWidth = dashboardFrame.split('\n').find(line => line.startsWith('╭'))?.length;
      view.stdin.write('d');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Delete "Write docs"?'));
      const frame = view.lastFrame() ?? '';
      expect(frame).toContain('This cannot be undone.');
      expect(frame).toContain('╭');
      expect(frame).toContain('╰');
      expect(frame.split('\n')).toHaveLength(dashboardHeight);
      expect(frame.split('\n').find(line => line.startsWith('╭'))?.length).toBe(dashboardWidth);
      expect(await service.list()).toHaveLength(1);
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Deletion cancelled'));
      expect(await service.list()).toHaveLength(1);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('cancels the delete prompt with Escape without removing the task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-delete-escape-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Write docs');
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Write docs'));
      view.stdin.write('d');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Delete "Write docs"?'));
      view.stdin.write('\u001b');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Deletion cancelled'));
      expect(await service.list()).toHaveLength(1);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('groups task details in an inner card with effort and deadline timing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-details-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Write docs', {estimate: '3h', due: '2026-09-25'});
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Write docs'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('TASK DETAILS'));
      const frame = view.lastFrame() ?? '';
      expect((frame.match(/╭/g) ?? []).length).toBe(2);
      expect(frame).toContain('Status: pending');
      expect(frame).toContain('Tracked: 0s');
      expect(frame).toContain('Effort left: 3h');
      expect(frame).toContain('Deadline:');
      expect(frame).toContain('Due in:');
      expect(frame).toContain('OVERVIEW');
      expect(frame).toContain('EFFORT');
      expect(frame).toContain('SCHEDULE');
      expect(frame).toContain('Progress:');
      expect(frame).toContain('Health:');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('shows a saved description in details but not in dashboard rows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-description-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Plan release', {description: 'Confirm rollout owners'});
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Plan release'));
      expect(view.lastFrame()).not.toContain('Confirm rollout owners');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Confirm rollout owners'));
      expect(view.lastFrame()).toContain('DESCRIPTION');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('collects a description while creating a task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-new-description-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No tasks'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task title'));
      view.stdin.write('Plan release');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Estimate'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Priority'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Deadline date'));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Description'));
      view.stdin.write('Confirm rollout owners');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task created'));
      expect((await service.list())[0]?.description).toBe('Confirm rollout owners');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('edits a description from the task form', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-edit-description-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Plan release', {description: 'Draft checklist'});
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Plan release'));
      view.stdin.write('e');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('EDIT TASK'));
      expect(view.lastFrame()).toContain('Description');
      for (let index = 0; index < 5; index++) view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toMatch(/› Description/));
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Draft checklist█'));
      view.stdin.write('Confirm rollout owners');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Confirm rollout owners'));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Task updated'));
      expect((await service.list())[0]?.description).toBe('Confirm rollout owners');
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });

  it.each([
    {screen: 'details', key: '\r', content: 'Status: pending', taskCount: 1},
    {screen: 'edit', key: 'e', content: 'Save changes', taskCount: 1},
    {screen: 'details', key: '\r', content: 'Status: pending', taskCount: 3},
    {screen: 'edit', key: 'e', content: 'Save changes', taskCount: 3}
  ])('keeps the $screen screen at dashboard width with $taskCount task(s)', async ({screen, key, content, taskCount}) => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-tui-layout-'));
    const service = new TodoService(new StoreRepository(join(directory, 'store.json')));
    await service.add('Write docs');
    for (let index = 1; index < taskCount; index++) await service.add(`Task ${index + 1}`);
    const view = render(<TodoApp service={service} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Write docs'));
      const dashboardFrame = view.lastFrame() ?? '';
      const dashboardHeight = dashboardFrame.split('\n').length;
      const dashboardWidth = dashboardFrame.split('\n').find(line => line.startsWith('╭'))?.length;
      view.stdin.write(key);
      await vi.waitFor(() => expect(view.lastFrame()).toContain(content));
      const modalFrame = view.lastFrame() ?? '';
      expect(modalFrame).toContain('╭');
      expect(modalFrame).toContain('╰');
      if (screen === 'details' || screen === 'edit') expect(modalFrame.split('\n').length).toBeGreaterThanOrEqual(dashboardHeight);
      else expect(modalFrame.split('\n').length).toBe(dashboardHeight);
      expect(modalFrame.split('\n').find(line => line.startsWith('╭'))?.length).toBe(dashboardWidth);
    } finally {
      view.unmount();
      await rm(directory, {recursive: true, force: true});
    }
  });
});
