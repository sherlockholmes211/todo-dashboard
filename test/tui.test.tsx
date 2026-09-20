import React from 'react';
import {render} from 'ink-testing-library';
import {describe, expect, it, vi} from 'vitest';
import {createTask, startTask} from '../src/domain.js';
import {Dashboard, TextPrompt} from '../src/tui.js';

const now = new Date('2026-09-20T10:00:00.000Z');
const tasks = [
  createTask({title: 'First task', estimateMs: 3_600_000}, now, '00000000-0000-4000-8000-000000000001'),
  startTask(createTask({title: 'Second task'}, now, '00000000-0000-4000-8000-000000000002'), now)
];

describe('Dashboard', () => {
  it('renders a plain adaptive task view with text health and no ANSI when monochrome', () => {
    const view = render(<Dashboard tasks={tasks} settings={{monochrome: true, symbols: 'ascii'}} width={120} now={() => now} />);
    expect(view.lastFrame()).toContain('TODO DASHBOARD');
    expect(view.lastFrame()).toContain('First task');
    expect(view.lastFrame()).toContain('UNKNOWN');
    expect(view.lastFrame()).not.toContain(String.fromCharCode(27));
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
