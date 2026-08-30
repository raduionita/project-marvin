import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { listIntegrations, loadIntegration, makeIntegrationToolName, loadIntegrationTools } from './index.js';
import { splitIntegrationToolName } from '../helpers.js';
import { Config, Integration, IntegrationMeta, Field } from '../types.js';

function mockEngine(): Engine {
  const engine = new Engine();
  engine.config = {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: {},
    models: {},
    agents: {},
    tasks: {},
    mcps: {},
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
  expect(integrations).toContain('wordpress');
});

test('listIntegrations excludes index.ts and tests', () => {
  const engine = mockEngine();
  const integrations = listIntegrations(engine);
  expect(integrations).not.toContain('index');
  expect(integrations).not.toContain('index.test');
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

// --- per-action integration tools ---

class MockIntegration extends Integration {
  meta: IntegrationMeta = {
    type: 'mock',
    title: 'Mock',
    description: 'Mock integration',
    arguments: { endpoint: 'https://example.com' },
    actions: {
      create_post: 'Create a post',
      publish_post: 'Publish a post',
    },
  };
  discoverResults: Record<string, Field[]> = {};

  async load() {}
  async drop() {}
  async call() { return { ok: true }; }
  async discover(action: string): Promise<Field[]> {
    return this.discoverResults[action] || [];
  }
}

test('integrationToolName round-trips through splitIntegrationToolName', () => {
  expect(makeIntegrationToolName('gloobeam', 'create_post')).toBe('gloobeam__create_post');
  expect(splitIntegrationToolName('gloobeam__create_post')).toEqual({ id: 'gloobeam', action: 'create_post' });
  expect(splitIntegrationToolName('web_search')).toBeNull();
  expect(splitIntegrationToolName('__create_post')).toBeNull();
  expect(splitIntegrationToolName('gloobeam__')).toBeNull();
});

test('builds a tool per configured action with its fields and required list', async () => {
  const engine = mockEngine();
  engine.integrations['site'] = new MockIntegration(engine, {
    type: 'mock',
    actions: {
      create_post: {
        enabled: true,
        fields: {
          title: { type: 'string', required: true, description: 'The title' },
          status: { type: 'string', enum: ['draft', 'publish'], description: 'Status' },
        },
      },
    },
  });

  const tools = await loadIntegrationTools(engine, ['site']);

  expect(tools.length).toBe(1);
  const fn = tools[0]!.function;
  expect(fn.name).toBe('site__create_post');
  expect(fn.description).toContain('Create a post');
  expect(fn.parameters.required).toEqual(['title']);
  expect(fn.parameters.properties.title).toEqual({ type: 'string', description: 'The title' });
  expect(fn.parameters.properties.status!.enum).toEqual(['draft', 'publish']);
});

test('exposes only configured actions once any action is configured', async () => {
  const engine = mockEngine();
  engine.integrations['site'] = new MockIntegration(engine, {
    type: 'mock',
    actions: { create_post: { enabled: true, fields: {} } },
  });

  const tools = await loadIntegrationTools(engine, ['site']);

  expect(tools.map(t => t.function.name)).toEqual(['site__create_post']);
});

test('adds custom meta fields to every action tool', async () => {
  const engine = mockEngine();
  engine.integrations['site'] = new MockIntegration(engine, {
    type: 'mock',
    meta: { target: 'meta', fields: { byline: { type: 'string', required: true, description: 'Byline' } } },
  });

  const tools = await loadIntegrationTools(engine, ['site']);

  expect(tools.length).toBe(2); // no configured actions: all meta actions exposed
  const create = tools.find(t => t.function.name === 'site__create_post')!;
  expect(create.function.parameters.properties.byline).toEqual({ type: 'string', description: 'Byline' });
  expect(create.function.parameters.required).toContain('byline');
});

test('falls back to live discovery when an action has no configured fields', async () => {
  const engine = mockEngine();
  const integration = new MockIntegration(engine, { type: 'mock' });
  integration.discoverResults['create_post'] = [{ name: 'content', type: 'string', required: false, description: 'Body' }];
  engine.integrations['site'] = integration;

  const tools = await loadIntegrationTools(engine, ['site']);
  const create = tools.find(t => t.function.name === 'site__create_post')!;

  expect(create.function.parameters.properties.content).toEqual({ type: 'string', description: 'Body' });
});

test('skips integrations that are not loaded', async () => {
  const engine = mockEngine();

  const tools = await loadIntegrationTools(engine, ['missing']);

  expect(tools).toEqual([]);
});
