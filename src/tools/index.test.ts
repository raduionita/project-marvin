import { test, expect } from 'bun:test';
import { listTools } from './index.js';
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

test('listTools returns tool files', () => {
  const ctx = mockContext();
  const tools = listTools(mockDaemon(ctx) as any);
  expect(Array.isArray(tools)).toBe(true);
  expect(tools.length).toBeGreaterThan(0);
});

test('listTools excludes index.ts', () => {
  const ctx = mockContext();
  const tools = listTools(mockDaemon(ctx) as any);
  expect(tools).not.toContain('index.ts');
});

test('listTools excludes test files', () => {
  const ctx = mockContext();
  const tools = listTools(mockDaemon(ctx) as any);
  expect(tools).not.toContain('getDate.test.ts');
});

test('listTools includes known tools', () => {
  const ctx = mockContext();
  const tools = listTools(mockDaemon(ctx) as any);
  expect(tools).toContain('getDate.ts');
  expect(tools).toContain('webSearch.ts');
  expect(tools).toContain('webBrowse.ts');
});
