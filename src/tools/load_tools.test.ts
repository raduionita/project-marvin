import { test, expect } from 'bun:test';
import { join } from 'path';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import LoadToolsTool from './load_tools.js';
import ReadFileTool from './read_file.js';
import WebSearchTool from './web_search.js';
import type { Chat } from '../types.js';
import { Agent } from '../agent.js';
import { Mcp } from '../mcp.js';

const MOCK_SERVER = join(import.meta.dirname, '..', 'mcp.mock.ts');

function mockEngine(): Engine {
  return new Engine();
}

function mockAgent(engine: Engine): Agent {
  return new Agent(engine, { id: 'test', identity: '', channels: {}, model: {} as any });
}

function mockChat(): Chat {
  return { id: 'c1', thinking: false, messages: [], tools: [] } as Chat;
}

test('loadTools tool metadata', () => {
  const engine = mockEngine();
  const tool = new LoadToolsTool(engine);
  expect(tool.meta.function.name).toBe('load_tools');
  expect(tool.meta.function.description).toContain('Load one or more callable tools');
  expect(tool.meta.function.parameters.required).toContain('tools');
  expect(tool.meta.function.parameters.properties.tools!.type).toBe('array');
  expect(tool.meta.group).toBe('control');
});

test('loadTools returns an error when no names are provided', async () => {
  const engine = mockEngine();
  const tool = new LoadToolsTool(engine);
  const result = await tool.call({ tools: [] }, mockAgent(engine), mockChat());
  expect(result.error).toContain('no tool names');
});

test('loadTools returns an error when names is missing', async () => {
  const engine = mockEngine();
  const tool = new LoadToolsTool(engine);
  const result = await tool.call({} as any, mockAgent(engine), mockChat());
  expect(result.error).toContain('no tool names');
});

test('loadTools adds the requested tool meta to chat.tools', async () => {
  const engine = mockEngine();
  engine.tools['read_file'] = new ReadFileTool(engine);
  engine.tools['web_search'] = new WebSearchTool(engine);
  const tool = new LoadToolsTool(engine);
  const chat: Chat = { id: 'c1', thinking: false, messages: [], tools: [] };

  const result = await tool.call({ tools: ['read_file'] }, mockAgent(engine), chat);

  expect(result.loaded).toEqual(['read_file']);
  expect(result.missing).toEqual([]);
  expect(chat.tools).toBeDefined();
  expect(chat.tools!.map(t => t.function.name)).toContain('read_file');
  expect(chat.tools!.map(t => t.function.name)).not.toContain('web_search');
});

test('loadTools adds multiple tool metas and reports missing ones', async () => {
  const engine = mockEngine();
  engine.tools['read_file'] = new ReadFileTool(engine);
  engine.tools['web_search'] = new WebSearchTool(engine);
  const tool = new LoadToolsTool(engine);
  const chat: Chat = { id: 'c1', thinking: false, messages: [], tools: [] };

  const result = await tool.call({ tools: ['read_file', 'web_search', 'nope'] }, mockAgent(engine), chat);

  expect(result.loaded.sort()).toEqual(['read_file', 'web_search']);
  expect(result.missing).toEqual(['nope']);
  expect(chat.tools!.map(t => t.function.name).sort()).toEqual(['read_file', 'web_search']);
});

test('loadTools is idempotent: loading twice does not duplicate metas', async () => {
  const engine = mockEngine();
  engine.tools['read_file'] = new ReadFileTool(engine);
  const tool = new LoadToolsTool(engine);
  const chat: Chat = { id: 'c1', thinking: false, messages: [], tools: [] };
  const agent = mockAgent(engine);

  await tool.call({ tools: ['read_file'] }, agent, chat);
  await tool.call({ tools: ['read_file'] }, agent, chat);

  const names = chat.tools!.map(t => t.function.name);
  expect(names.filter(n => n === 'read_file').length).toBe(1);
});

test('loadTools initialises chat.tools when undefined', async () => {
  const engine = mockEngine();
  engine.tools['read_file'] = new ReadFileTool(engine);
  const tool = new LoadToolsTool(engine);
  const chat: Chat = { id: 'c1', thinking: false, messages: [] };

  const result = await tool.call({ tools: ['read_file'] }, mockAgent(engine), chat);

  expect(result.loaded).toEqual(['read_file']);
  expect(chat.tools).toBeDefined();
  expect(chat.tools!.length).toBe(1);
});

test('loadTools reports loaded/missing with chat required', async () => {
  const engine = mockEngine();
  engine.tools['read_file'] = new ReadFileTool(engine);
  const tool = new LoadToolsTool(engine);
  const chat = mockChat();

  const result = await tool.call({ tools: ['read_file', 'nope'] }, mockAgent(engine), chat);

  expect(result.loaded).toEqual(['read_file']);
  expect(result.missing).toEqual(['nope']);
});

// mcp-backed .call coverage: mock stdio server exposes echo, peek_env, weird.name
function mockEngineWithMcp(id = 'mock'): Engine {
  const engine = mockEngine();
  engine.tools['read_file'] = new ReadFileTool(engine);
  engine.mcps[id] = new Mcp(engine, id, {
    enabled: true,
    command: process.execPath,
    args: [MOCK_SERVER],
  });
  return engine;
}

test('loadTools loads internal + mcp tools into chat.tools and reports loaded/missing', async () => {
  const engine = mockEngineWithMcp();
  const tool = new LoadToolsTool(engine);
  const chat = mockChat();
  try {
    const result = await tool.call({ tools: ['read_file', 'mock__echo'] }, mockAgent(engine), chat);

    expect(result.loaded.sort()).toEqual(['mock__echo', 'read_file']);
    expect(result.missing).toEqual([]);
    const names = chat.tools!.map(t => t.function.name);
    expect(names.sort()).toEqual(['mock__echo', 'read_file']);
    const echo = chat.tools!.find(t => t.function.name === 'mock__echo')!;
    expect(echo.group).toBe('mock');
    expect(echo.function.parameters.properties.text).toBeDefined();
  } finally {
    await engine.mcps['mock']?.drop();
  }
});

test('loadTools loads sanitized mcp tool names', async () => {
  const engine = mockEngineWithMcp();
  const tool = new LoadToolsTool(engine);
  const chat = mockChat();
  try {
    const result = await tool.call({ tools: ['mock__weird_name'] }, mockAgent(engine), chat);
    expect(result.loaded).toEqual(['mock__weird_name']);
    expect(result.missing).toEqual([]);
    expect(chat.tools!.map(t => t.function.name)).toContain('mock__weird_name');
  } finally {
    await engine.mcps['mock']?.drop();
  }
});

test('loadTools reports unknown mcp id and unknown mcp tool as missing', async () => {
  const engine = mockEngineWithMcp();
  const tool = new LoadToolsTool(engine);
  try {
    const chat = mockChat();
    const unknownId = await tool.call({ tools: ['unknown__echo'] }, mockAgent(engine), chat);
    expect(unknownId.loaded).toEqual([]);
    expect(unknownId.missing).toEqual(['unknown__echo']);
    expect(chat.tools).toEqual([]);

    const unknownTool = await tool.call({ tools: ['mock__nope'] }, mockAgent(engine), chat);
    expect(unknownTool.loaded).toEqual([]);
    expect(unknownTool.missing).toEqual(['mock__nope']);
    expect(chat.tools).toEqual([]);
  } finally {
    await engine.mcps['mock']?.drop();
  }
});

test('loadTools handles mixed internal/mcp/missing batches', async () => {
  const engine = mockEngineWithMcp();
  engine.tools['web_search'] = new WebSearchTool(engine);
  const tool = new LoadToolsTool(engine);
  const chat = mockChat();
  try {
    const result = await tool.call(
      { tools: ['read_file', 'mock__echo', 'nope', 'unknown__foo', 'mock__nope'] },
      mockAgent(engine),
      chat,
    );
    expect(result.loaded.sort()).toEqual(['mock__echo', 'read_file']);
    expect(result.missing.sort()).toEqual(['mock__nope', 'nope', 'unknown__foo']);
    expect(chat.tools!.map(t => t.function.name).sort()).toEqual(['mock__echo', 'read_file']);
  } finally {
    await engine.mcps['mock']?.drop();
  }
});

test('loadTools dedupes duplicates within a single call (internal + mcp)', async () => {
  const engine = mockEngineWithMcp();
  const tool = new LoadToolsTool(engine);
  const chat = mockChat();
  try {
    await tool.call({ tools: ['read_file', 'read_file', 'mock__echo', 'mock__echo'] }, mockAgent(engine), chat);
    const names = chat.tools!.map(t => t.function.name);
    expect(names.filter(n => n === 'read_file').length).toBe(1);
    expect(names.filter(n => n === 'mock__echo').length).toBe(1);
    expect(chat.tools!.length).toBe(2);
  } finally {
    await engine.mcps['mock']?.drop();
  }
});

test('loadTools mcp load is idempotent across calls', async () => {
  const engine = mockEngineWithMcp();
  const tool = new LoadToolsTool(engine);
  const chat = mockChat();
  const agent = mockAgent(engine);
  try {
    await tool.call({ tools: ['mock__echo'] }, agent, chat);
    await tool.call({ tools: ['mock__echo'] }, agent, chat);
    expect(chat.tools!.filter(t => t.function.name === 'mock__echo').length).toBe(1);
  } finally {
    await engine.mcps['mock']?.drop();
  }
});

test('loadTools preserves pre-existing chat.tools entries', async () => {
  const engine = mockEngineWithMcp();
  engine.tools['web_search'] = new WebSearchTool(engine);
  const tool = new LoadToolsTool(engine);
  const chat = mockChat();
  chat.tools!.push(engine.tools['web_search']!.meta);
  try {
    const result = await tool.call({ tools: ['read_file', 'mock__echo'] }, mockAgent(engine), chat);
    expect(result.loaded.sort()).toEqual(['mock__echo', 'read_file']);
    expect(chat.tools!.map(t => t.function.name).sort()).toEqual(['mock__echo', 'read_file', 'web_search']);
  } finally {
    await engine.mcps['mock']?.drop();
  }
});

test('loadTools engine meta wins over stale chat.tools duplicates', async () => {
  const engine = mockEngine();
  engine.tools['read_file'] = new ReadFileTool(engine);
  const tool = new LoadToolsTool(engine);
  const stale = { ...engine.tools['read_file']!.meta, group: 'stale' };
  const chat: Chat = { id: 'c1', thinking: false, messages: [], tools: [stale, stale] } as Chat;

  await tool.call({ tools: ['read_file'] }, mockAgent(engine), chat);

  expect(chat.tools!.length).toBe(1);
  expect(chat.tools![0]).toBe(engine.tools['read_file']!.meta);
});

test('loadTools treats malformed mcp-like names as missing without crashing', async () => {
  const engine = mockEngineWithMcp();
  const tool = new LoadToolsTool(engine);
  const chat = mockChat();
  try {
    const result = await tool.call({ tools: ['trailing__', 'mock', '__echo'] }, mockAgent(engine), chat);
    expect(result.loaded).toEqual([]);
    expect(result.missing.sort()).toEqual(['__echo', 'mock', 'trailing__']);
    expect(chat.tools).toEqual([]);
  } finally {
    await engine.mcps['mock']?.drop();
  }
});

test('loadTools rejects non-array tools input', async () => {
  const engine = mockEngine();
  const tool = new LoadToolsTool(engine);
  expect((await tool.call({ tools: 'read_file' } as any, mockAgent(engine), mockChat())).error).toContain('no tool names');
  expect((await tool.call({ tools: null } as any, mockAgent(engine), mockChat())).error).toContain('no tool names');
});
