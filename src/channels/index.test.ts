import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { listChannels } from './index.js';
import { Config } from '../types.js';

function mockEngine(config: Config = {} as Config): Engine {
  const engine = new Engine();
  engine.config = {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: config.channels || {},
    models: {},
    agents: {},
    tasks: {},
    mcps: {},
  } as Config;
  engine.channels = {};
  engine.models = {};
  engine.agents = {};
  engine.tools = {};
  engine.state = 'exec';
  (engine as any).isTest = true; // allow .mock.ts files
  return engine;
}

test('listChannels returns channel files', () => {
  const engine = mockEngine();
  const channels = listChannels(engine);
  expect(Array.isArray(channels)).toBe(true);
  expect(channels.length).toBeGreaterThan(0);
});

test('listChannels excludes index.ts', () => {
  const engine = mockEngine();
  const channels = listChannels(engine);
  expect(channels).not.toContain('index.ts');
});

test('listChannels excludes test files', () => {
  const engine = mockEngine();
  const channels = listChannels(engine);
  expect(channels).not.toContain('slack.test.ts');
});

test('listChannels includes known channels', () => {
  const engine = mockEngine();
  const channels = listChannels(engine);
  expect(channels).toContain('slack');
  expect(channels).toContain('telegram');
  expect(channels).toContain('whatsapp');
  expect(channels).toContain('channel.mock');
});
