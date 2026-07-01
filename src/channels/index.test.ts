import { test, expect } from 'bun:test';
import { listChannels } from './index.js';
import { Context } from '../context.js';
import { Config } from '../types.js';

function mockContext(config: Config = {} as Config): Context {
  const ctx = new Context();
  ctx.config = {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 7331, logLevel: 'info' },
    channels: config.channels || {},
    models: {},
    agents: {},
  } as Config;
  ctx.channels = {};
  ctx.models = {};
  ctx.agents = {};
  ctx.tools = {};
  ctx.state = 'running';
  (ctx as any).isTest = true; // allow .mock.ts files
  return ctx;
}

test('listChannels returns channel files', () => {
  const ctx = mockContext();
  const channels = listChannels(ctx);
  expect(Array.isArray(channels)).toBe(true);
  expect(channels.length).toBeGreaterThan(0);
});

test('listChannels excludes index.ts', () => {
  const ctx = mockContext();
  const channels = listChannels(ctx);
  expect(channels).not.toContain('index.ts');
});

test('listChannels excludes test files', () => {
  const ctx = mockContext();
  const channels = listChannels(ctx);
  expect(channels).not.toContain('slack.test.ts');
});

test('listChannels includes known channels', () => {
  const ctx = mockContext();
  const channels = listChannels(ctx);
  expect(channels).toContain('slack.ts');
  expect(channels).toContain('telegram.ts');
  expect(channels).toContain('whatsapp.ts');
  expect(channels).toContain('example.ts');
  expect(channels).toContain('channel.mock.ts');
});
