import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import FindIntegrationTool from './find_integration.js';
import { Integration } from '../types.js';

class WordpressLikeIntegration extends Integration {
  meta = { type: 'wordpress', title: 'Wordpress', description: 'Post articles to a wordpress site', arguments: { endpoint: 'https://gloobeam.com' }, actions: { create_post: 'Create a post' } };
  async load() {}
  async drop() {}
  async call() { return {}; }
}

function mockEngine(config: { [key: string]: any } = {}): Engine {
  const engine = new Engine(new Logger());
  engine.state = 'exec';
  const integration = new WordpressLikeIntegration(engine, new Logger(), { type: 'wordpress', endpoint: 'https://gloobeam.com', ...config });
  engine.integrations = { gloobeam: integration };
  engine.config.integrations = { gloobeam: { type: 'wordpress', ...config } };
  return engine;
}

test('find_integration returns the configured field schema for an action', async () => {
  const engine = mockEngine({
    actions: { create_post: { enabled: true, fields: { title: { type: 'string', required: true, description: 'Post title' }, content: { type: 'string', required: false, description: 'Post body' } } } },
  });
  const tool = new FindIntegrationTool(engine, new Logger());

  const result = (await tool.call({ integration: 'gloobeam', action: 'create_post' })) as { id: string, type: string, action: string, fields: { name: string }[], required_fields: string[] };

  expect(result.id).toBe('gloobeam');
  expect(result.type).toBe('wordpress');
  expect(result.action).toBe('create_post');
  expect(result.fields.map(f => f.name)).toEqual(['title', 'content']);
  expect(result.required_fields).toEqual(['title']);
});

test('find_integration returns no fields when none are configured', async () => {
  const engine = mockEngine();
  const tool = new FindIntegrationTool(engine, new Logger());

  const result = (await tool.call({ integration: 'gloobeam', action: 'create_post' })) as { fields: { name: string }[], required_fields: string[] };

  expect(result.fields).toEqual([]);
  expect(result.required_fields).toEqual([]);
});

test('find_integration prefers the curated config schema over defaults', async () => {
  const engine = mockEngine({
    actions: { create_post: { enabled: true, fields: { title: { type: 'string', required: true, description: 'Title' }, meta_author: { type: 'string', required: true, description: 'Byline' } } } },
  });
  const tool = new FindIntegrationTool(engine, new Logger());

  const result = (await tool.call({ integration: 'gloobeam', action: 'create_post' })) as { fields: { name: string }[], required_fields: string[] };

  expect(result.fields.map(f => f.name)).toEqual(['title', 'meta_author']);
  expect(result.required_fields).toEqual(['title', 'meta_author']);
});

test('find_integration includes meta fields with their target', async () => {
  const engine = mockEngine({
    actions: { create_post: { enabled: true, fields: { title: { type: 'string', required: true } } } },
    meta: { target: 'acf', fields: { custom_author: { type: 'string', required: true, description: 'Byline' } } },
  });
  const tool = new FindIntegrationTool(engine, new Logger());

  const result = (await tool.call({ integration: 'gloobeam', action: 'create_post' })) as { fields: { name: string, meta?: string }[], required_fields: string[] };

  expect(result.fields.find(f => f.name === 'custom_author')?.meta).toBe('acf');
  expect(result.required_fields).toContain('custom_author');
});

test('find_integration errors for an unknown integration', async () => {
  const engine = mockEngine();
  const tool = new FindIntegrationTool(engine, new Logger());

  const result = await tool.call({ integration: 'nope', action: 'create_post' });

  expect(result.error).toContain('does not exist');
});

test('find_integration errors for an unknown action', async () => {
  const engine = mockEngine();
  const tool = new FindIntegrationTool(engine, new Logger());

  const result = await tool.call({ integration: 'gloobeam', action: 'explode' });

  expect(result.error).toContain('does not exist');
  expect(result.actions).toEqual(['create_post']);
});
