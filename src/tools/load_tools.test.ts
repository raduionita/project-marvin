import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import LoadToolsTool from './load_tools.js';
import ReadFileTool from './read_file.js';
import WebSearchTool from './web_search.js';
import type { Chat } from '../types.js';
import { Agent } from '../agent.js';

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
  expect(tool.meta.function.parameters.required).toContain('names');
  expect(tool.meta.function.parameters.properties.names!.type).toBe('array');
  expect(tool.meta.group).toBe('control');
});

test('loadTools returns an error when no names are provided', async () => {
  const engine = mockEngine();
  const tool = new LoadToolsTool(engine);
  const result = await tool.call({ names: [] }, mockAgent(engine), mockChat());
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

  const result = await tool.call({ names: ['read_file'] }, mockAgent(engine), chat);

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

  const result = await tool.call({ names: ['read_file', 'web_search', 'nope'] }, mockAgent(engine), chat);

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

  await tool.call({ names: ['read_file'] }, agent, chat);
  await tool.call({ names: ['read_file'] }, agent, chat);

  const names = chat.tools!.map(t => t.function.name);
  expect(names.filter(n => n === 'read_file').length).toBe(1);
});

test('loadTools initialises chat.tools when undefined', async () => {
  const engine = mockEngine();
  engine.tools['read_file'] = new ReadFileTool(engine);
  const tool = new LoadToolsTool(engine);
  const chat: Chat = { id: 'c1', thinking: false, messages: [] };

  const result = await tool.call({ names: ['read_file'] }, mockAgent(engine), chat);

  expect(result.loaded).toEqual(['read_file']);
  expect(chat.tools).toBeDefined();
  expect(chat.tools!.length).toBe(1);
});

test('loadTools reports loaded/missing with chat required', async () => {
  const engine = mockEngine();
  engine.tools['read_file'] = new ReadFileTool(engine);
  const tool = new LoadToolsTool(engine);
  const chat = mockChat();

  const result = await tool.call({ names: ['read_file', 'nope'] }, mockAgent(engine), chat);

  expect(result.loaded).toEqual(['read_file']);
  expect(result.missing).toEqual(['nope']);
});
