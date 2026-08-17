import { mock, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../types.js';
import * as constants from '../constants.js';
import Engine from '../engine.js';
import { Logger } from '../logger.js';

// scripted answers consumed by the mocked terminal prompt
let answers: string[] = [];
mock.module('../terminal.js', () => ({
  ask: mock(async () => answers.shift() ?? ''),
}));

import TasksCommand from './tasks.js';

function mockConfig(agents: Config['agents'], tasks: Config['tasks'] = {}): Config {
  return {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: {},
    models: {},
    agents,
    tasks,
  } as Config;
}

test('tasks add writes TASK.md and persists config', async () => {
  const engine = new Engine(new Logger());
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({
    'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {} },
  });

  const cmd = new TasksCommand(engine, new Logger(), []);
  answers = ['', 'my-task', 'do the thing every hour', '7200', '5', 'text'];
  await cmd.execAdd();

  // TASK.md created with the prompt
  const ppath = join(engine.work, 'tasks', 'my-task', 'TASK.md');
  expect(existsSync(ppath)).toBe(true);
  expect(readFileSync(ppath, 'utf8').trim()).toBe('do the thing every hour');

  // config entry persisted
  expect(engine.config.tasks!['my-task']).toEqual({
    enabled: true,
    agent: 'my-agent',
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
  const engine = new Engine(new Logger());
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({});

  const cmd = new TasksCommand(engine, new Logger(), []);
  answers = ['ghost-agent'];
  await cmd.execAdd();

  expect(existsSync(join(engine.work, 'tasks', 'ghost-agent'))).toBe(false);
});

test('tasks add refuses existing task', async () => {
  const engine = new Engine(new Logger());
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {} } },
    { 'my-task': { enabled: true, agent: 'my-agent', schedule: 3600, maxSteps: 20, format: 'json' } },
  );

  const cmd = new TasksCommand(engine, new Logger(), []);
  answers = ['my-agent', 'my-task'];
  await cmd.execAdd();

  expect(Object.keys(engine.config.tasks!)).toEqual(['my-task']);
  expect(existsSync(join(engine.work, 'tasks', 'my-task'))).toBe(false);
});

test('tasks add skips TASK.md when prompt is blank', async () => {
  const engine = new Engine(new Logger());
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({
    'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {} },
  });

  const cmd = new TasksCommand(engine, new Logger(), []);
  answers = ['', 'empty-task', '', '60', '', ''];
  await cmd.execAdd();

  expect(existsSync(join(engine.work, 'tasks', 'empty-task', 'TASK.md'))).toBe(false);
  expect(engine.config.tasks!['empty-task']).toEqual({
    enabled: true,
    agent: 'my-agent',
    schedule: 60,
    maxSteps: 20,
    format: 'json',
    schema: constants.DEFAULT_SCHEMA,
  });
});

test('tasks add links configured integrations, skipping unknown ones', async () => {
  const engine = new Engine(new Logger());
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({
    'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {} },
  });
  engine.config.integrations = {
    'gloobeam': { enabled: true, type: 'wordpress' },
    'other-site': { enabled: true, type: 'wordpress' },
  } as Config['integrations'];

  const cmd = new TasksCommand(engine, new Logger(), []);
  answers = ['', 'post-task', 'write a post', '60', '5', 'json', 'gloobeam, nope'];
  await cmd.execAdd();

  expect(engine.config.tasks!['post-task']).toEqual({
    enabled: true,
    agent: 'my-agent',
    schedule: 60,
    maxSteps: 5,
    format: 'json',
    schema: constants.DEFAULT_SCHEMA,
    integrations: ['gloobeam'],
  });
});