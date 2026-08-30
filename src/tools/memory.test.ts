import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { Agent } from '../agent.js';
import MemoryTool from './memory.js';
import { safeJoin } from '../helpers/index.js';

function mockEngine(): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  const engine = new Engine();
  engine.work = home;
  return { engine, home };
}

function mockAgent(engine: Engine): Agent {
  return new Agent(engine, { id: 'test-agent' });
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

test('memory tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new MemoryTool(engine);
  expect(tool.meta.function.name).toBe('memory');
  expect(tool.meta.function.parameters.required).toContain('operation');
  cleanup(engine.work);
});

test('memory remembers and recalls a note', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const saved = await tool.call({ operation: 'remember', key: 'user-preferences', content: 'Prefers concise answers' }, agent);
  expect(saved.error).toBeUndefined();

  const recalled = await tool.call({ operation: 'recall', key: 'user-preferences' }, agent);
  expect(recalled.content).toBe('Prefers concise answers');
  cleanup(home);
});

test('memory stores notes as files under ~/.marvin/memories/<agent-id>', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  await tool.call({ operation: 'remember', key: 'facts', content: 'Earth is round' }, agent);

  expect(existsSync(safeJoin(home, 'memories', 'test-agent', 'facts.md')!)).toBe(true);
  cleanup(home);
});

test('memory scopes notes to the calling agent', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const alice = new Agent(engine, { id: 'alice' });
  const bob = new Agent(engine, { id: 'bob' });

  await tool.call({ operation: 'remember', key: 'facts', content: 'alice note' }, alice);

  const bobNote = await tool.call({ operation: 'recall', key: 'facts' }, bob);
  expect(bobNote.error).toContain('not found');

  const bobList = await tool.call({ operation: 'list' }, bob);
  expect(bobList.notes).toEqual([]);

  const aliceNote = await tool.call({ operation: 'recall', key: 'facts' }, alice);
  expect(aliceNote.content).toBe('alice note');
  cleanup(home);
});

test('memory sanitizes keys into safe file names', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const saved = await tool.call({ operation: 'remember', key: '../escape', content: 'nope' }, agent);
  expect(saved.error).toBeUndefined();

  // key sanitized to "escape", stored inside the agent's memory dir
  expect(existsSync(safeJoin(home, 'memories', 'test-agent', 'escape.md')!)).toBe(true);
  expect(existsSync(join(home, '..', 'escape.md'))).toBe(false);
  cleanup(home);
});

test('memory recall returns an error for a missing note', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const result = await tool.call({ operation: 'recall', key: 'missing' }, agent);

  expect(result.error).toContain('not found');
  cleanup(home);
});

test('memory forget deletes a note', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);
  await tool.call({ operation: 'remember', key: 'temp', content: 'x' }, agent);

  const result = await tool.call({ operation: 'forget', key: 'temp' }, agent);

  expect(result.ok).toBe(true);
  expect(existsSync(safeJoin(home, 'memories', 'test-agent', 'temp.md')!)).toBe(false);
  cleanup(home);
});

test('memory forget returns an error for a missing note', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const result = await tool.call({ operation: 'forget', key: 'missing' }, agent);

  expect(result.error).toContain('not found');
  cleanup(home);
});

test('memory list shows all notes with previews', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);
  await tool.call({ operation: 'remember', key: 'alpha', content: 'First note' }, agent);
  await tool.call({ operation: 'remember', key: 'beta', content: 'Second note' }, agent);

  const result = await tool.call({ operation: 'list' }, agent);

  const notes = result.notes as { key: string; preview: string }[];
  expect(notes.length).toBe(2);
  expect(notes.map(n => n.key).sort()).toEqual(['alpha', 'beta']);
  expect(notes.find(n => n.key === 'alpha')?.preview).toBe('First note');
  cleanup(home);
});

test('memory list returns an empty array when no notes exist', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const result = await tool.call({ operation: 'list' }, agent);

  expect(result.notes).toEqual([]);
  cleanup(home);
});

test('memory without an agent context falls back to the orchestrator', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);

  await tool.call({ operation: 'remember', key: 'facts', content: 'orchestrator note' });

  expect(existsSync(safeJoin(home, 'memories', 'marvin', 'facts.md')!)).toBe(true);
  cleanup(home);
});

test('memory returns an error when no operation is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const result = await tool.call({} as { operation: string }, agent);

  expect(result.error).toContain('no operation provided');
  cleanup(home);
});

test('memory returns an error for an unknown operation', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const result = await tool.call({ operation: 'bogus' }, agent);

  expect(result.error).toContain('unknown operation');
  cleanup(home);
});

test('memory remember requires a key', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const result = await tool.call({ operation: 'remember', content: 'x' }, agent);

  expect(result.error).toBe('memory: no key provided for remember');
  cleanup(home);
});

test('memory remember requires content', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const result = await tool.call({ operation: 'remember', key: 'x' }, agent);

  expect(result.error).toBe('memory: no content provided for remember');
  cleanup(home);
});

test('memory recall requires a key', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);

  const result = await tool.call({ operation: 'recall' }, agent);

  expect(result.error).toBe('memory: no key provided for recall');
  cleanup(home);
});

test('memory overwrites an existing note on remember', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);
  await tool.call({ operation: 'remember', key: 'facts', content: 'old' }, agent);

  await tool.call({ operation: 'remember', key: 'facts', content: 'new' }, agent);

  const recalled = await tool.call({ operation: 'recall', key: 'facts' }, agent);
  expect(recalled.content).toBe('new');
  cleanup(home);
});

test('memory ignores existing files outside the memory dir', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine);
  const agent = mockAgent(engine);
  writeFileSync(join(home, 'notes.md'), 'not memory');

  const result = await tool.call({ operation: 'list' }, agent);

  expect(result.notes).toEqual([]);
  cleanup(home);
});
