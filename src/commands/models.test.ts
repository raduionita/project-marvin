import { mock, test, expect } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../types.js';
import Engine from '../engine.js';
import { buildPromptMocks, captureLogger } from '../helpers/tests.js';

// scripted answers consumed by the mocked @inquirer/prompts prompts
let answers: string[] = [];
const promptMocks = buildPromptMocks(() => answers);
mock.module('@inquirer/prompts', () => promptMocks);

import ModelsCommand from './models.js';

function mockConfig(models: Config['models'], agents: Config['agents'] = {}): Config {
  return {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    models,
    agents,
    tasks: {},
    mcps: {},
  } as Config;
}

function mockEngine(models: Config['models'] = {}, agents: Config['agents'] = {}): Engine {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(models, agents);
  return engine;
}

function mockAgent(model: string): Config['agents'][string] {
  return { enabled: true, model, channels: {} };
}

test('execHelp prints usage and actions', () => {
  const engine = mockEngine();
  const { lines, restore } = captureLogger();

  new ModelsCommand(engine, []).execHelp();

  const out = lines.join('\n');
  expect(out).toContain('usage: marvin models [action]');
  expect(out).toContain('list');
  expect(out).toContain('add');
  expect(out).toContain('edit');
  restore();
});

test('exec defaults to help when no action is given', async () => {
  const engine = mockEngine();
  const { lines, restore } = captureLogger();

  await new ModelsCommand(engine, []).exec();

  expect(lines.join('\n')).toContain('usage: marvin models [action]');
  restore();
});

test('exec warns and shows help on unknown action', async () => {
  const engine = mockEngine();
  const { lines, restore } = captureLogger();

  await new ModelsCommand(engine, ['frobnicate']).exec();

  const out = lines.join('\n');
  expect(out).toContain('unknown action');
  expect(out).toContain('usage: marvin models [action]');
  restore();
});

test('execList prints available providers', () => {
  const engine = mockEngine({
    'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'gpt-4o-mini' },
  });
  const { lines, restore } = captureLogger();

  new ModelsCommand(engine, []).execList();

  const out = lines.join('\n');
  expect(out).toContain('list models:');
  expect(out).toContain('openai');
  expect(out).toContain('anthropic');
  expect(out).toContain('google');
  restore();
});

test('execAdd stores the model and persists config', async () => {
  const engine = mockEngine();
  answers = ['gpt-4o-mini', 'openai', '', 'sk-test'];

  await new ModelsCommand(engine, []).execAdd();

  const modelId = 'openai/gpt-4o-mini';
  expect(engine.config.models[modelId]).toEqual({
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com',
    apiKey: 'sk-test',
    enabled: true,
  });

  // config file persisted too
  const cpath = join(engine.work, 'marvin.json');
  expect(existsSync(cpath)).toBe(true);
  expect(JSON.parse(readFileSync(cpath, 'utf-8')).models[modelId].apiKey).toBe('sk-test');
});

test('execAdd detects the provider from the model name on blank input', async () => {
  const engine = mockEngine();
  answers = ['claude-sonnet-4', '', '', 'sk-test'];

  await new ModelsCommand(engine, []).execAdd();

  expect(engine.config.models['anthropic/claude-sonnet-4']!.provider).toBe('anthropic');
});

test('execAdd detects baseUrl from the model name on blank input', async () => {
  const engine = mockEngine();
  answers = ['deepseek-chat', 'openai', '', 'sk-test'];

  await new ModelsCommand(engine, []).execAdd();

  expect(engine.config.models['openai/deepseek-chat']!.baseUrl).toBe('https://api.deepseek.com');
});

test('execAdd respects an explicit baseUrl', async () => {
  const engine = mockEngine();
  answers = ['my-model', 'openai', 'http://localhost:1234', 'sk-test'];

  await new ModelsCommand(engine, []).execAdd();

  expect(engine.config.models['openai/my-model']!.baseUrl).toBe('http://localhost:1234');
});

test('execAdd binds selected agents to the new model', async () => {
  const engine = mockEngine({}, {
    'a1': mockAgent('openai/old'),
    'a2': mockAgent('openai/old'),
  });
  answers = ['gpt-4o-mini', 'openai', '', 'sk-test', '1'];

  await new ModelsCommand(engine, []).execAdd();

  expect(engine.config.agents['a1']!.model).toBe('openai/gpt-4o-mini');
  expect(engine.config.agents['a2']!.model).toBe('openai/old');
});

test('execAdd binds no agents when none are selected', async () => {
  const engine = mockEngine({}, { 'a1': mockAgent('openai/old') });
  answers = ['gpt-4o-mini', 'openai', '', 'sk-test', 'none'];

  await new ModelsCommand(engine, []).execAdd();

  expect(engine.config.agents['a1']!.model).toBe('openai/old');
});

test('execEdit renames the model and repoints bound agents', async () => {
  const engine = mockEngine(
    { 'openai/gpt-old': { enabled: true, provider: 'openai', model: 'gpt-old', baseUrl: 'https://api.openai.com', apiKey: 'sk-old' } },
    { 'a1': mockAgent('openai/gpt-old'), 'a2': mockAgent('openai/other') },
  );
  answers = ['', 'gpt-new', '', '', ''];

  await new ModelsCommand(engine, ['edit', 'openai/gpt-old']).execEdit();

  expect(engine.config.models['openai/gpt-old']).toBeUndefined();
  expect(engine.config.models['openai/gpt-new']).toEqual({
    enabled: true,
    provider: 'openai',
    model: 'gpt-new',
    baseUrl: 'https://api.openai.com',
    apiKey: 'sk-old',
  });
  expect(engine.config.agents['a1']!.model).toBe('openai/gpt-new');
  expect(engine.config.agents['a2']!.model).toBe('openai/other');
});

test('execEdit keeps values on blank input and updates in place', async () => {
  const engine = mockEngine({
    'google/gemini-2.0-flash': { enabled: true, provider: 'google', model: 'gemini-2.0-flash', apiKey: 'sk-g' },
  });
  answers = ['', '', '', '', ''];

  await new ModelsCommand(engine, ['edit', 'google/gemini-2.0-flash']).execEdit();

  expect(engine.config.models['google/gemini-2.0-flash']).toEqual({
    enabled: true,
    provider: 'google',
    model: 'gemini-2.0-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'sk-g',
  });
});

test('execEdit warns when no models are configured', async () => {
  const engine = mockEngine();
  const { lines, restore } = captureLogger();

  await new ModelsCommand(engine, ['edit']).execEdit();

  expect(lines.join('\n')).toContain('no models configured');
  restore();
});

test('execEdit errors on unknown model id', async () => {
  const engine = mockEngine({
    'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'gpt-4o-mini' },
  });
  const { lines, restore } = captureLogger();

  await new ModelsCommand(engine, ['edit', 'nope']).execEdit();

  expect(lines.join('\n')).toContain('not found in config');
  restore();
});

test('exec dispatches list, add and edit', async () => {
  const engine = mockEngine({
    'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'gpt-4o-mini' },
  });
  const { lines, restore } = captureLogger();

  await new ModelsCommand(engine, ['list']).exec();
  expect(lines.join('\n')).toContain('list models:');
  restore();

  answers = ['gemini-2.0-flash', 'google', '', 'sk-test'];
  await new ModelsCommand(engine, ['add']).exec();
  expect(engine.config.models['google/gemini-2.0-flash']!.baseUrl)
    .toBe('https://generativelanguage.googleapis.com');

  answers = ['', '', '', '', ''];
  await new ModelsCommand(engine, ['edit', 'google/gemini-2.0-flash']).exec();
  expect(engine.config.models['google/gemini-2.0-flash']!.enabled).toBe(true);
});
