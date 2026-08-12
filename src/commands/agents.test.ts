import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../types.js';
import * as constants from '../constants.js';
import Engine from '../engine.js';
import AgentsCommand from './agents.js';

function mockConfig(models: Config['models'], channels: Config['channels']): Config {
  return {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels,
    integrations: {},
    models,
    agents: {},
  } as Config;
}

function scriptedAsk(answers: string[]) {
  const queue = [...answers];
  return async () => queue.shift() || '';
}

test('agents add writes IDENTITY.md and persists config', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    { slack: { enabled: true } },
  );

  const cmd = new AgentsCommand(engine, []);
  cmd.ask = scriptedAsk(['my-agent', '', 'slack', 'general', 'I am a test agent']);
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
    tasks: {},
  });

  // config file persisted too
  const cpath = join(engine.work, 'marvin.json');
  expect(existsSync(cpath)).toBe(true);
});

test('agents add refuses unknown model', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    {},
  );

  const cmd = new AgentsCommand(engine, []);
  cmd.ask = scriptedAsk(['my-agent', 'gpt-4']);
  await cmd.execAdd();

  expect(engine.config.agents['my-agent']).toBeUndefined();
  expect(existsSync(join(engine.work, 'agents', 'my-agent'))).toBe(false);
});

test('agents add refuses existing agent', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    {},
  );
  engine.config.agents['my-agent'] = { enabled: true, model: 'deepseek/deepseek-chat', channels: {}, tasks: {} };

  const cmd = new AgentsCommand(engine, []);
  cmd.ask = scriptedAsk(['my-agent']);
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
  cmd.ask = scriptedAsk(['my-agent', '', '', '']);
  await cmd.execAdd();

  const ipath = join(engine.work, 'agents', 'my-agent', 'IDENTITY.md');
  expect(readFileSync(ipath, 'utf8').trim()).toBe(constants.IDENTITY_MD.trim());
});