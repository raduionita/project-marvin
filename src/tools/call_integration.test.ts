import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import CallIntegrationTool from './call_integration.js';
import { Integration, Config } from '../types.js';

function mockEngine(integrations: Record<string, Integration> = {}, configIntegrations: { [id: string]: { type: string; [key: string]: any } } = {}): Engine {
  const engine = new Engine();
  engine.integrations = integrations;
  engine.config.integrations = configIntegrations as Config['integrations'];
  engine.state = 'exec';
  return engine;
}

class FakeIntegration extends Integration {
  meta = { type: 'fake', title: 'Fake', description: '', arguments: { endpoint: 'https://example.com' }, tools: {} };
  calls: { tool: string, params: { [key: string]: any } }[] = [];
  async load() {}
  async drop() {}
  async call(args: { [key: string]: any }) {
    this.calls.push({ tool: args.action, params: args });
    return { ok: true, echo: args };
  }
}

class WordpressLikeIntegration extends Integration {
  meta = { type: 'wordpress', title: 'Wordpress', description: '', arguments: { endpoint: 'https://example.com' }, tools: { create_post: 'Create a post', publish_post: 'Publish a post' } };
  async load() {}
  async drop() {}
  async call() { return {}; }
}

test('call_integration executes an action on the configured integration', async () => {
  const fake = new FakeIntegration(new Engine(), { type: 'fake', endpoint: 'https://example.com' });
  const engine = mockEngine({ gloobeam: fake });
  const tool = new CallIntegrationTool(engine);

  const result = await tool.call({ integration: 'gloobeam', tool: 'create_post', params: { title: 'Hello' } });

  expect(result).toEqual({ ok: true, echo: { tool: 'create_post', title: 'Hello' } });
  expect(fake.calls[0]?.tool).toBe('create_post');
});

test('call_integration works without params', async () => {
  const fake = new FakeIntegration(new Engine(), { type: 'fake' });
  const engine = mockEngine({ gloobeam: fake });
  const tool = new CallIntegrationTool(engine);

  const result = await tool.call({ integration: 'gloobeam', tool: 'list_posts' });

  expect(result).toEqual({ ok: true, echo: { tool: 'list_posts' } });
});

test('call_integration returns an error for an unknown integration', async () => {
  const engine = mockEngine();
  const tool = new CallIntegrationTool(engine);

  const result = await tool.call({ integration: 'nope', tool: 'create_post' });

  expect(result.error).toContain('does not exist');
  expect(result.integrations).toEqual([]);
});

test('call_integration meta reflects the configured integration ids', async () => {
  const engine = mockEngine({}, { gloobeam: { type: 'wordpress' }, other: { type: 'wordpress' } });
  const tool = new CallIntegrationTool(engine);

  const meta = tool.meta;
  const integrationProp = meta.function.parameters.properties.integration!;
  expect(integrationProp.enum).toEqual(['gloobeam', 'other']);
  expect(meta.function.parameters.required).toEqual(['integration', 'action']);
});

test('call_integration meta exposes the union of actions from loaded integrations', async () => {
  const engine = mockEngine({ gloobeam: new WordpressLikeIntegration(new Engine(), { type: 'wordpress' }) }, { gloobeam: { type: 'wordpress' } });
  const tool = new CallIntegrationTool(engine);

  const meta = tool.meta;
  expect(meta.function.parameters.properties.action!.enum).toEqual(['create_post', 'publish_post']);
});
