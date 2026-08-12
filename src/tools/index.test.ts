import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { listTools } from './index.js';
import { Config } from '../types.js';

function mockEngine(config: Config = {} as Config): Engine {
  const engine = new Engine();
  engine.config = {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: config.channels || {},
    integrations: {},
    models: {},
    agents: {},
  } as Config;
  engine.channels = {};
  engine.models = {};
  engine.agents = {};
  engine.tools = {};
  engine.state = 'exec';
  (engine as any).isTest = true; // allow .mock.ts files
  return engine;
}

test('listTools returns tool files', () => {
  const engine = mockEngine();
  const tools = listTools(engine);
  expect(Array.isArray(tools)).toBe(true);
  expect(tools.length).toBeGreaterThan(0);
});

test('listTools excludes index.ts', () => {
  const engine = mockEngine();
  const tools = listTools(engine);
  expect(tools).not.toContain('index.ts');
});

test('listTools excludes test files', () => {
  const engine = mockEngine();
  const tools = listTools(engine);
  expect(tools).not.toContain('get_date.test.ts');
});

test('listTools includes known tools', () => {
  const engine = mockEngine();
  const tools = listTools(engine);
  expect(tools).toContain('get_date.ts');
  expect(tools).toContain('web_search.ts');
  expect(tools).toContain('web_browse.ts');
  expect(tools).toContain('read_file.ts');
  expect(tools).toContain('edit_file.ts');
  expect(tools).toContain('marvin_state.ts');
  expect(tools).toContain('marvin_config.ts');
  expect(tools).toContain('call_integration.ts');
});
