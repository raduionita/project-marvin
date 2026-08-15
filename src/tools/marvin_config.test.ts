import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import MarvinConfigTool from './marvin_config.js';

function mockEngine(config: object): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'marvin.json'), JSON.stringify(config, null, 2));
  const engine = new Engine(new Logger());
  engine.work = home;
  return { engine, home };
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

const sample = {
  settings: { name: 'marvin', host: '127.0.0.1', port: 7331, logLevel: 'info' },
  models: { llm: { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
  agents: {},
  channels: { slack: { enabled: true } },
};

test('marvinConfig tool metadata', () => {
  const { engine } = mockEngine(sample);
  const tool = new MarvinConfigTool(engine, new Logger());
  expect(tool.meta.function.name).toBe('marvin_config');
});

test('marvinConfig reads the whole config', async () => {
  const { engine, home } = mockEngine(sample);
  const tool = new MarvinConfigTool(engine, new Logger());

  const result: { [key: string]: any } = await tool.call({});

  expect(result.path).toBe(join(home, 'marvin.json'));
  expect(result.config.settings.port).toBe(7331);
  expect(result.config.models.llm.provider).toBe('deepseek');
  cleanup(home);
});

test('marvinConfig reads a dotted key', async () => {
  const { engine, home } = mockEngine(sample);
  const tool = new MarvinConfigTool(engine, new Logger());

  const result = await tool.call({ key: 'models.llm.model' });
  expect(result.value).toBe('deepseek-chat');

  const missing = await tool.call({ key: 'agents.foo.bar' });
  expect(missing.value).toBeUndefined();
  cleanup(home);
});

test('marvinConfig sets a string value', async () => {
  const { engine, home } = mockEngine(sample);
  const tool = new MarvinConfigTool(engine, new Logger());

  const result = await tool.call({ operation: 'set', key: 'settings.name', value: 'hitchhiker' });

  expect(result.ok).toBe(true);
  expect(JSON.parse(readFileSync(join(home, 'marvin.json'), 'utf-8')).settings.name).toBe('hitchhiker');
  expect(engine.config.settings.name).toBe('hitchhiker');
  cleanup(home);
});

test('marvinConfig sets a JSON value', async () => {
  const { engine, home } = mockEngine(sample);
  const tool = new MarvinConfigTool(engine, new Logger());

  await tool.call({ operation: 'set', key: 'settings.port', value: '9000' });
  expect(JSON.parse(readFileSync(join(home, 'marvin.json'), 'utf-8')).settings.port).toBe(9000);
  cleanup(home);
});

test('marvinConfig creates nested keys on set', async () => {
  const { engine, home } = mockEngine(sample);
  const tool = new MarvinConfigTool(engine, new Logger());

  const result = await tool.call({ operation: 'set', key: 'agents.monitor.enabled', value: 'true' });

  expect(result.ok).toBe(true);
  const saved = JSON.parse(readFileSync(join(home, 'marvin.json'), 'utf-8'));
  expect(saved.agents.monitor.enabled).toBe(true);
  cleanup(home);
});

test('marvinConfig requires a key for set', async () => {
  const { engine, home } = mockEngine(sample);
  const tool = new MarvinConfigTool(engine, new Logger());

  const result = await tool.call({ operation: 'set', value: 'x' });
  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('key');
  cleanup(home);
});

test('marvinConfig rejects an invalid key', async () => {
  const { engine, home } = mockEngine(sample);
  const tool = new MarvinConfigTool(engine, new Logger());

  const result = await tool.call({ operation: 'set', key: 'settings.', value: 'x' });
  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('invalid key');
  cleanup(home);
});

test('marvinConfig reports an error when marvin.json is missing', async () => {
  const { engine, home } = mockEngine(sample);
  rmSync(join(home, 'marvin.json'));
  const tool = new MarvinConfigTool(engine, new Logger());

  const result = await tool.call({});
  expect(result.config).toBeUndefined();
  expect(result.error).toContain('could not read config');
  cleanup(home);
});
