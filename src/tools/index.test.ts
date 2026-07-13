import { test, expect } from 'bun:test';
import { listTools } from './index.js';
import { Context } from '../types.js';
import { Config, App } from '../types.js';

function mockContext(config: Config = {} as Config): Context {
  const ctx = new Context();
  ctx.config = {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
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

test('listTools returns tool files', () => {
  const ctx = mockContext();
  const tools = listTools(ctx);
  expect(Array.isArray(tools)).toBe(true);
  expect(tools.length).toBeGreaterThan(0);
});

test('listTools excludes index.ts', () => {
  const ctx = mockContext();
  const tools = listTools(ctx);
  expect(tools).not.toContain('index.ts');
});

test('listTools excludes test files', () => {
  const ctx = mockContext();
  const tools = listTools(ctx);
  expect(tools).not.toContain('getDate.test.ts');
});

test('listTools includes known tools', () => {
  const ctx = mockContext();
  const tools = listTools(ctx);
  expect(tools).toContain('getDate.ts');
  expect(tools).toContain('webSearch.ts');
  expect(tools).toContain('webBrowse.ts');
});
