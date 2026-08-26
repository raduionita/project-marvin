import { test, expect } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import Engine from './engine.js';
import { Logger } from './logger.js';
import { Mcp, mcpToolName, loadMcpTools } from './mcp.js';
import { splitMcpToolName } from './helpers.js';
import { sanitizeToolName } from './helpers.js';

// path of the mock stdio mcp server (run with the current bun binary)
const MOCK_SERVER = join(import.meta.dirname, 'mcp.mock.ts');

function buildEngine(): Engine {
  const engine = new Engine(new Logger());
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  return engine;
}

function buildClient(engine: Engine, env?: Record<string, string>): Mcp {
  return new Mcp(engine, engine.logger, 'mock', {
    enabled: true,
    command: process.execPath,
    args: [MOCK_SERVER],
    ...(env ? { env } : {}),
  });
}

test('sanitizeToolName maps invalid characters to underscores', () => {
  expect(sanitizeToolName('echo')).toBe('echo');
  expect(sanitizeToolName('weird.name')).toBe('weird_name');
  expect(sanitizeToolName('a b/c.d')).toBe('a_b_c_d');
});

test('mcpToolName and splitMcpToolName round-trip', () => {
  expect(mcpToolName('gloobeam', 'create_post')).toBe('gloobeam__create_post');
  expect(splitMcpToolName('gloobeam__create_post')).toEqual({ id: 'gloobeam', name: 'create_post' });
  // double underscore keeps single underscores intact on both sides
  expect(splitMcpToolName('my_mcp__weird_name')).toEqual({ id: 'my_mcp', name: 'weird_name' });
  // non-mcp names split to null
  expect(splitMcpToolName('web_search')).toBeNull();
  expect(splitMcpToolName('trailing__')).toBeNull();
});

test('load connects to a stdio server and lists its tools', async () => {
  const engine = buildEngine();
  const client = buildClient(engine);

  await client.load();

  expect(client.isLoaded).toBe(true);
  // tools keyed by sanitized name, each keeping its raw server name
  expect(Object.keys(client.tools).sort()).toEqual(['echo', 'peek_env', 'weird_name']);
  expect(client.tools['weird_name']!.name).toBe('weird.name');
  expect(client.tools['echo']!.name).toBe('echo');

  await client.drop();
});

test('callTool echoes arguments and flattens text content', async () => {
  const engine = buildEngine();
  const client = buildClient(engine);
  await client.load();

  const result = await client.call('echo', { text: 'hi marvin' });
  expect(result.text).toBe('echo: hi marvin');

  await client.drop();
});

test('callTool forwards configured env to the server process', async () => {
  const engine = buildEngine();
  const client = buildClient(engine, { MOCK_MCP_TOKEN: 'secret-token' });
  await client.load();

  const result = await client.call('peek_env');
  expect(result.text).toBe('MOCK_MCP_TOKEN=secret-token');

  await client.drop();
});

test('callTool throws on in-band tool errors (isError)', async () => {
  const engine = buildEngine();
  const client = buildClient(engine);
  await client.load();

  await client.call('fail').then(
    () => { throw new Error('expected callTool to throw'); },
    (err) => expect(err.message).toContain('boom'),
  );

  await client.drop();
});

test('callTool reconnects after drop', async () => {
  const engine = buildEngine();
  const client = buildClient(engine);
  await client.load();
  await client.drop();

  expect(client.isLoaded).toBe(false);

  // callTool must lazily reconnect
  const result = await client.call('echo', { text: 'again' });
  expect(result.text).toBe('echo: again');

  await client.drop();
});

test('loadMcpTools builds metas from the server tool list', async () => {
  const engine = buildEngine();

  const client = new Mcp(engine, engine.logger, 'mock', {
    enabled: true,
    command: process.execPath,
    args: [MOCK_SERVER],
  });
  engine.mcps['mock'] = client;

  const tools = await loadMcpTools(engine, ['mock']);

  const echo = tools.find(t => t.function.name === 'mock__echo');
  expect(echo).toBeDefined();
  expect(echo!.function.description).toBe('Echo the input text');
  expect(echo!.function.parameters.type).toBe('object');
  expect(echo!.function.parameters.properties.text).toBeDefined();
  expect(echo!.function.parameters.required).toEqual(['text']);

  // sanitized tool names
  expect(tools.map(t => t.function.name)).toContain('mock__weird_name');

  // unknown ids are skipped (warned), missing clients too
  const none = await loadMcpTools(engine, ['nope']);
  expect(none).toEqual([]);

  await client.drop();
});
