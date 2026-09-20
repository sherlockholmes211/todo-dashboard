#!/usr/bin/env node
import {createInterface} from 'node:readline/promises';
import {stdin, stdout} from 'node:process';
import {join} from 'node:path';
import envPaths from 'env-paths';
import React from 'react';
import {render} from 'ink';
import {executeCli, selectInterface} from './cli.js';
import {formatDashboard} from './format.js';
import {TodoService} from './service.js';
import {StoreRepository} from './storage.js';
import {TodoApp} from './tui.js';

const paths = envPaths('todo-dashboard', {suffix: ''});
const repository = new StoreRepository(join(paths.data, 'store.json'));
const service = new TodoService(repository);
const args = process.argv.slice(2);
const mode = selectInterface(args, Boolean(stdin.isTTY), Boolean(stdout.isTTY));

async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({input: stdin, output: stdout});
  try {
    return /^(y|yes)$/i.test((await prompt.question(`${question} [y/N] `)).trim());
  } finally {
    prompt.close();
  }
}

try {
  if (mode === 'tui') {
    const instance = render(<TodoApp service={service} />);
    await instance.waitUntilExit();
  } else if (mode === 'static') {
    const store = await service.getStore();
    stdout.write(formatDashboard(store.tasks, new Date(), store.settings));
  } else {
    process.exitCode = await executeCli(args, {
      service,
      stdout: value => stdout.write(value),
      stderr: value => process.stderr.write(value),
      isTTY: Boolean(stdin.isTTY && stdout.isTTY),
      confirm
    });
  }
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
