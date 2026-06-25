import { test, expect } from 'bun:test';
import { listChannels } from './index.js';
import { Context } from '../context.js';
import { Config, App } from '../types.js';

class MockDaemon extends App {
  public context: Context;

  constructor(ctx: Context) {
    super();
    this.context = ctx;
  }

  async exec(): Promise<void> {
    // no-op for tests
  }
}

function mockContext(config: Config = {} as Config): Context {
  const ctx = new Context();
  ctx.config = {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 19384, logLevel: 'info' },
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

function mockDaemon(ctx: Context): App {
  return new MockDaemon(ctx);
}

test('listChannels returns channel files', () => {
  const ctx = mockContext();
  const channels = listChannels(mockDaemon(ctx) as any);
  expect(Array.isArray(channels)).toBe(true);
  expect(channels.length).toBeGreaterThan(0);
});

test('listChannels excludes index.ts', () => {
  const ctx = mockContext();
  const channels = listChannels(mockDaemon(ctx) as any);
  expect(channels).not.toContain('index.ts');
});

test('listChannels excludes test files', () => {
  const ctx = mockContext();
  const channels = listChannels(mockDaemon(ctx) as any);
  expect(channels).not.toContain('slack.test.ts');
});

test('listChannels includes known channels', () => {
  const ctx = mockContext();
  const channels = listChannels(mockDaemon(ctx) as any);
  expect(channels).toContain('slack.ts');
  expect(channels).toContain('telegram.ts');
  expect(channels).toContain('whatsapp.ts');
  expect(channels).toContain('example.ts');
  expect(channels).toContain('channel.mock.ts');
});
