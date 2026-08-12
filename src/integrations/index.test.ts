import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { listIntegrations, loadIntegration } from './index.js';
import { Config } from '../types.js';

function mockEngine(): Engine {
  const engine = new Engine();
  engine.config = {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: {},
    models: {},
    agents: {},
  } as Config;
  engine.integrations = {};
  engine.state = 'exec';
  (engine as any).isTest = true;
  return engine;
}

test('listIntegrations returns integration files', () => {
  const engine = mockEngine();
  const integrations = listIntegrations(engine);
  expect(Array.isArray(integrations)).toBe(true);
  expect(integrations.length).toBeGreaterThan(0);
  expect(integrations).toContain('wordpress.ts');
});

test('listIntegrations excludes index.ts and tests', () => {
  const engine = mockEngine();
  const integrations = listIntegrations(engine);
  expect(integrations).not.toContain('index.ts');
  expect(integrations).not.toContain('index.test.ts');
});

test('loadIntegration returns an Integration instance for a known type', async () => {
  const engine = mockEngine();
  const integration = await loadIntegration(engine, 'wordpress', { type: 'wordpress' });
  expect(integration).not.toBeNull();
  expect(integration!.config.type).toBe('wordpress');
});

test('loadIntegration returns null for an unknown type', async () => {
  const engine = mockEngine();
  const integration = await loadIntegration(engine, 'nope', { type: 'nope' });
  expect(integration).toBeNull();
});