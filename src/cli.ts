import {createRequire} from 'node:module';
import {Command} from 'commander';
import {formatDashboard, formatTask, taskToJson} from './format.js';
import type {TodoService} from './service.js';

type CliDependencies = {
  service: TodoService;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  isTTY: boolean;
  confirm: (question: string) => Promise<boolean>;
  version?: string;
};

const packageVersion = (createRequire(import.meta.url)('../package.json') as {version: string}).version;

export type InterfaceMode = 'tui' | 'static' | 'cli';

export function selectInterface(args: string[], stdinTTY: boolean, stdoutTTY: boolean): InterfaceMode {
  if (args.length > 0) return 'cli';
  return stdinTTY && stdoutTTY ? 'tui' : 'static';
}

export async function executeCli(args: string[], dependencies: CliDependencies): Promise<number> {
  const {service, stdout, stderr} = dependencies;
  const output = (value: unknown, json = false) => stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${String(value)}\n`);
  const taskOutput = (task: Awaited<ReturnType<TodoService['show']>>, json = false) => output(json ? taskToJson(task) : formatTask(task), json);
  const configValue = (value: unknown) => typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  const program = new Command()
    .name('todo')
    .description('Task dashboard with concurrent timers')
    .version(dependencies.version ?? packageVersion)
    .exitOverride()
    .configureOutput({writeOut: stdout, writeErr: stderr});

  program.command('add')
    .argument('<title>')
    .option('--estimate <duration>')
    .option('--priority <level>')
    .option('--due <deadline>')
    .option('--json')
    .action(async (title: string, options: {estimate?: string; due?: string; priority?: string; json?: boolean}) => {
      taskOutput(await service.add(title, options), options.json);
    });

  program.command('list')
    .option('--all')
    .option('--json')
    .action(async (options: {all?: boolean; json?: boolean}) => {
      const tasks = await service.list(options.all === undefined ? {} : {all: options.all});
      if (options.json) output(tasks.map(task => taskToJson(task)), true);
      else stdout(formatDashboard(tasks));
    });

  program.command('show')
    .argument('<id>')
    .option('--json')
    .action(async (id: string, options: {json?: boolean}) => taskOutput(await service.show(id), options.json));

  program.command('edit')
    .argument('<id>')
    .option('--title <text>')
    .option('--priority <level>')
    .option('--estimate <duration>')
    .option('--remaining <duration>')
    .option('--due <deadline>')
    .option('--clear-estimate')
    .option('--clear-due')
    .action(async (id: string, options) => taskOutput(await service.edit(id, options)));

  program.command('start').argument('<id>').action(async (id: string) => taskOutput(await service.start(id)));
  const pause = program.command('pause').argument('[id]').option('--all');
  pause.action(async (id: string | undefined, options: {all?: boolean}) => {
    if (options.all) {
      const tasks = await service.pauseAll();
      output(`Paused ${tasks.length} task${tasks.length === 1 ? '' : 's'}`);
    } else if (id) taskOutput(await service.pause(id));
    else throw new Error('Provide a task ID or --all');
  });
  program.command('done').argument('<id>').action(async (id: string) => taskOutput(await service.done(id)));
  program.command('reopen').argument('<id>').action(async (id: string) => taskOutput(await service.reopen(id)));
  program.command('delete')
    .argument('<id>')
    .option('--force')
    .action(async (id: string, options: {force?: boolean}) => {
      if (!options.force) {
        if (!dependencies.isTTY) throw new Error('Non-interactive deletion requires --force');
        const task = await service.show(id);
        if (!await dependencies.confirm(`Delete "${task.title}"?`)) throw new Error('Deletion cancelled');
      }
      const deleted = await service.delete(id);
      output(`Deleted ${deleted.id.slice(0, 8)} ${deleted.title}`);
    });

  const config = program.command('config');
  config.command('list').action(async () => output(await service.listConfig(), true));
  config.command('get').argument('<key>').action(async (key: string) => output(configValue(await service.getConfig(key))));
  config.command('set').argument('<key>').argument('<value>').action(async (key: string, value: string) => {
    await service.setConfig(key, value);
    output(`${key}=${configValue(await service.getConfig(key))}`);
  });

  program.command('doctor')
    .option('--restore-backup')
    .action(async (options: {restoreBackup?: boolean}) => {
      if (options.restoreBackup) {
        const store = await service.repository.restoreBackup();
        output(`Backup restored at revision ${store.revision}`);
      } else {
        const report = await service.repository.doctor();
        if (!report.ok) throw new Error(report.error ?? 'Store is unhealthy');
        output(`Store is healthy (revision ${report.revision}, backup ${report.backupValid ? 'valid' : 'not present'})`);
      }
    });

  try {
    await program.parseAsync(['node', 'todo', ...args]);
    return 0;
  } catch (error) {
    const commanderError = error as {code?: string; exitCode?: number; message?: string};
    if (commanderError.code === 'commander.helpDisplayed' || commanderError.code === 'commander.version') return 0;
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('error:')) stderr(`Error: ${message}\n`);
    return commanderError.exitCode && commanderError.exitCode !== 0 ? commanderError.exitCode : 1;
  }
}
