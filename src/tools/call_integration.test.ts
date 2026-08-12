import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import CallIntegrationTool from './call_integration.js';
import { Integration } from '../types.js';

function mockEngine(integrations: Record<string, Integration> = {}): Engine {
  const engine = new Engine();
  engine.integrations = integrations;
  engine.state = 'exec';
  return engine;
}

class FakeIntegration extends Integration {
  args = { endpoint: 'https://example.com' };
  calls: { action: string, params: { [key: string]: any } }[] = [];
  async load() {}
  async drop() {}
  async call(args: { [key: string]: any }) {
    this.calls.push({ action: args.action, params: args });
    return { ok: true, echo: args };
  }
}

test('call_integration executes an action on the configured integration', async () => {
  const fake = new FakeIntegration(new Engine(), { type: 'fake', endpoint: 'https://example.com' });
  const engine = mockEngine({ gloobeam: fake });
  const tool = new CallIntegrationTool(engine);

  const result = await tool.call({ integration: 'gloobeam', action: 'create_post', params: { title: 'Hello' } });

  expect(result).toEqual({ ok: true, echo: { action: 'create_post', title: 'Hello' } });
  expect(fake.calls[0]?.action).toBe('create_post');
});

test('call_integration works without params', async () => {
  const fake = new FakeIntegration(new Engine(), { type: 'fake' });
  const engine = mockEngine({ gloobeam: fake });
  const tool = new CallIntegrationTool(engine);

  const result = await tool.call({ integration: 'gloobeam', action: 'list_posts' });

  expect(result).toEqual({ ok: true, echo: { action: 'list_posts' } });
});

test('call_integration returns an error for an unknown integration', async () => {
  const engine = mockEngine();
  const tool = new CallIntegrationTool(engine);

  const result = await tool.call({ integration: 'nope', action: 'create_post' });

  expect(result.error).toContain('does not exist');
  expect(result.integrations).toEqual([]);
});