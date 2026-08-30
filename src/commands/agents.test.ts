import { mock, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../types.js';
import * as constants from '../constants.js';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { buildPromptMocks } from '../helpers/tests.js';

// scripted answers consumed by the mocked @inquirer/prompts prompts
let answers: string[] = [];
const promptMocks = buildPromptMocks(() => answers);
mock.module('@inquirer/prompts', () => promptMocks);

import AgentsCommand from './agents.js';

function mockConfig(models: Config['models'], channels: Config['channels']): Config {
  return {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels,
    integrations: {},
    models,
    agents: {},
    tasks: {},
    mcps: {},
  } as Config;
}

test('agents add writes IDENTITY.md and persists config', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    { slack: { enabled: true } },
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent', '', '1', 'general', 'I am a test agent'];
  await cmd.execAdd();

  // IDENTITY.md created with the provided identity
  const ipath = join(engine.work, 'agents', 'my-agent', 'IDENTITY.md');
  expect(existsSync(ipath)).toBe(true);
  expect(readFileSync(ipath, 'utf8').trim()).toBe('I am a test agent');

  // config entry persisted
  expect(engine.config.agents['my-agent']).toEqual({
    enabled: true,
    model: 'deepseek/deepseek-chat',
    channels: { slack: 'general' },
  });

  // config file persisted too
  const cpath = join(engine.work, 'marvin.json');
  expect(existsSync(cpath)).toBe(true);
});

test('agents add refuses existing agent', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    {},
  );
  engine.config.agents['my-agent'] = { enabled: true, model: 'deepseek/deepseek-chat', channels: {} };

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent'];
  await cmd.execAdd();

  // still single entry, identity dir untouched
  expect(Object.keys(engine.config.agents)).toEqual(['my-agent']);
  expect(existsSync(join(engine.work, 'agents', 'my-agent'))).toBe(false);
});

test('agents add uses default identity when blank', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    {},
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent', '', '', ''];
  await cmd.execAdd();

  const ipath = join(engine.work, 'agents', 'my-agent', 'IDENTITY.md');
  expect(readFileSync(ipath, 'utf8').trim()).toBe(constants.IDENTITY_MD.trim());
});

test('agents add picks the group from cached channel info', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    { slack: { enabled: true, groups: { C1: 'general', C2: 'random' } } },
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent', '', '', 'C2', 'I am a test agent'];
  await cmd.execAdd();

  expect(engine.config.agents['my-agent']).toEqual({
    enabled: true,
    model: 'deepseek/deepseek-chat',
    channels: { slack: 'C2' },
  });
});

test('agents add falls back to manual group entry via the (type manually) choice', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    { slack: { enabled: true, groups: { C1: 'general' } } },
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent', '', '', '__manual__', 'C9', 'I am a test agent'];
  await cmd.execAdd();

  expect(engine.config.agents['my-agent']!.channels.slack).toBe('C9');
});
