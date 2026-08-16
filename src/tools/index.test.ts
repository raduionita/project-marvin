import { test, expect } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { listTools, listCustomTools } from './index.js';
import { Config } from '../types.js';

function mockEngine(config: Config = {} as Config): Engine {
  const engine = new Engine(new Logger());
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
  expect(tools).toContain('get_date');
  expect(tools).toContain('web_search');
  expect(tools).toContain('web_browse');
  expect(tools).toContain('read_file');
  expect(tools).toContain('edit_file');
  expect(tools).toContain('marvin_state');
  expect(tools).toContain('marvin_config');
  expect(tools).toContain('call_integration');
});

test('listCustomTools returns [] when the workspace tools folder is missing', () => {
  const engine = mockEngine();
  engine.work = join(tmpdir(), 'marvin-no-tools-' + Date.now());
  expect(listCustomTools(engine)).toEqual([]);
});

test('listCustomTools returns workspace tool files when present', () => {
  const engine = mockEngine();
  engine.work = join(tmpdir(), 'marvin-tools-' + Date.now());
  mkdirSync(join(engine.work, 'tools'), { recursive: true });
  writeFileSync(join(engine.work, 'tools', 'my_tool.ts'), 'export default class MyTool {}');
  writeFileSync(join(engine.work, 'tools', 'index.ts'), 'export {};');
  writeFileSync(join(engine.work, 'tools', 'my_tool.test.ts'), 'export {};');

  const tools = listCustomTools(engine);
  expect(tools).toEqual(['my_tool']);
});
