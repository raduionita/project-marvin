import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../types.js';
import * as constants from '../constants.js';
import Engine from '../engine.js';
import TasksCommand from './tasks.js';

function mockConfig(agents: Config['agents']): Config {
  return {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    models: {},
    agents,
  } as Config;
}

function scriptedAsk(answers: string[]) {
  const queue = [...answers];
  return async () => queue.shift() || '';
}

test('tasks add writes TASK.md and persists config', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({
    'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {}, tasks: {} },
  });

  const cmd = new TasksCommand(engine, []);
  cmd.ask = scriptedAsk(['', 'my-task', 'do the thing every hour', '7200', '5', 'text']);
  await cmd.execAdd();

  // TASK.md created with the prompt
  const ppath = join(engine.work, 'agents', 'my-agent', 'tasks', 'my-task', 'TASK.md');
  expect(existsSync(ppath)).toBe(true);
  expect(readFileSync(ppath, 'utf8').trim()).toBe('do the thing every hour');

  // config entry persisted
  expect(engine.config.agents['my-agent']!.tasks!['my-task']).toEqual({
    enabled: true,
    schedule: 7200,
    maxSteps: 5,
    format: 'text',
    schema: constants.DEFAULT_SCHEMA,
  });

  // config file persisted too
  const cpath = join(engine.work, 'marvin.json');
  expect(existsSync(cpath)).toBe(true);
});

test('tasks add refuses unknown agent', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({});

  const cmd = new TasksCommand(engine, []);
  cmd.ask = scriptedAsk(['ghost-agent']);
  await cmd.execAdd();

  expect(existsSync(join(engine.work, 'agents', 'ghost-agent'))).toBe(false);
});

test('tasks add refuses existing task', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({
    'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {}, tasks: { 'my-task': { enabled: true, schedule: 3600, maxSteps: 20, format: 'json' } } },
  });

  const cmd = new TasksCommand(engine, []);
  cmd.ask = scriptedAsk(['my-agent', 'my-task']);
  await cmd.execAdd();

  expect(Object.keys(engine.config.agents['my-agent']!.tasks!)).toEqual(['my-task']);
  expect(existsSync(join(engine.work, 'agents', 'my-agent', 'tasks', 'my-task'))).toBe(false);
});

test('tasks add skips TASK.md when prompt is blank', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({
    'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {}, tasks: {} },
  });

  const cmd = new TasksCommand(engine, []);
  cmd.ask = scriptedAsk(['', 'empty-task', '', '60', '', '']);
  await cmd.execAdd();

  expect(existsSync(join(engine.work, 'agents', 'my-agent', 'tasks', 'empty-task', 'TASK.md'))).toBe(false);
  expect(engine.config.agents['my-agent']!.tasks!['empty-task']).toEqual({
    enabled: true,
    schedule: 60,
    maxSteps: 20,
    format: 'json',
    schema: constants.DEFAULT_SCHEMA,
  });
});