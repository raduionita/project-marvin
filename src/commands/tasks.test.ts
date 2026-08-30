import { mock, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../types.js';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { buildPromptMocks } from '../tests.js';

// scripted answers consumed by the mocked @inquirer/prompts prompts
let answers: string[] = [];
const promptMocks = buildPromptMocks(() => answers);
mock.module('@inquirer/prompts', () => promptMocks);

// injectable editor prompt (no $EDITOR in tests)
let taskPromptSnippet = '';
mock.module('../terminal.js', () => ({ ...promptMocks, editor: async () => taskPromptSnippet }));

import TasksCommand from './tasks.js';

function mockConfig(agents: Config['agents'], tasks: Config['tasks'] = {}): Config {
  return {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: {},
    models: {},
    agents,
    tasks,
    mcps: {},
  } as Config;
}

test('tasks add writes TASK.md and persists config', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({
    'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {} },
  });

  const cmd = new TasksCommand(engine, []);
  answers = ['', 'my-task', '7200'];
  taskPromptSnippet = 'do the thing every hour';
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
  });

  // config file persisted too
  const cpath = join(engine.work, 'marvin.json');
  expect(existsSync(cpath)).toBe(true);
});

test('tasks add refuses unknown agent', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({});

  const cmd = new TasksCommand(engine, ['add', 'ghost-agent']);
  await cmd.execAdd();

  expect(existsSync(join(engine.work, 'tasks', 'ghost-agent'))).toBe(false);
});

test('tasks add refuses existing task', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {} } },
    { 'my-task': { enabled: true, agent: 'my-agent', schedule: 3600 } },
  );

  const cmd = new TasksCommand(engine, []);
  answers = ['my-agent', 'my-task'];
  await cmd.execAdd();

  expect(Object.keys(engine.config.tasks!)).toEqual(['my-task']);
  expect(existsSync(join(engine.work, 'tasks', 'my-task'))).toBe(false);
});

test('tasks add skips TASK.md when prompt is blank', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({
    'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {} },
  });

  const cmd = new TasksCommand(engine, []);
  answers = ['', 'empty-task', '60'];
  taskPromptSnippet = '';
  await cmd.execAdd();

  expect(existsSync(join(engine.work, 'tasks', 'empty-task', 'TASK.md'))).toBe(false);
  expect(engine.config.tasks!['empty-task']).toEqual({
    enabled: true,
    agent: 'my-agent',
    schedule: 60,
  });
});

test('tasks add links configured integrations via checkbox', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({
    'my-agent': { enabled: true, model: 'deepseek/deepseek-chat', channels: {} },
  });
  engine.config.integrations = {
    'gloobeam': { enabled: true, type: 'wordpress' },
    'other-site': { enabled: true, type: 'wordpress' },
  } as Config['integrations'];

  const cmd = new TasksCommand(engine, []);
  answers = ['', 'post-task', '60', '1'];
  taskPromptSnippet = 'write a post';
  await cmd.execAdd();

  expect(engine.config.tasks!['post-task']).toEqual({
    enabled: true,
    agent: 'my-agent',
    schedule: 60,
    integrations: ['gloobeam'],
  });
});
