import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import MemoryTool from './memory.js';
import { safeJoin } from '../helpers.js';

function mockEngine(): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  const engine = new Engine(new Logger());
  engine.work = home;
  return { engine, home };
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

test('memory tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());
  expect(tool.meta.function.name).toBe('memory');
  expect(tool.meta.function.parameters.required).toContain('operation');
  cleanup(engine.work);
});

test('memory remembers and recalls a note', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const saved = await tool.call({ operation: 'remember', key: 'user-preferences', content: 'Prefers concise answers' });
  expect(saved.error).toBeUndefined();

  const recalled = await tool.call({ operation: 'recall', key: 'user-preferences' });
  expect(recalled.content).toBe('Prefers concise answers');
  cleanup(home);
});

test('memory stores notes as files under ~/.marvin/memories', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  await tool.call({ operation: 'remember', key: 'facts', content: 'Earth is round' });

  expect(existsSync(safeJoin(home, 'memories', 'facts.md')!)).toBe(true);
  cleanup(home);
});

test('memory sanitizes keys into safe file names', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const saved = await tool.call({ operation: 'remember', key: '../escape', content: 'nope' });
  expect(saved.error).toBeUndefined();

  // key sanitized to "escape", stored inside the memories dir
  expect(existsSync(safeJoin(home, 'memories', 'escape.md')!)).toBe(true);
  expect(existsSync(join(home, '..', 'escape.md'))).toBe(false);
  cleanup(home);
});

test('memory recall returns an error for a missing note', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const result = await tool.call({ operation: 'recall', key: 'missing' });

  expect(result.error).toContain('not found');
  cleanup(home);
});

test('memory forget deletes a note', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());
  await tool.call({ operation: 'remember', key: 'temp', content: 'x' });

  const result = await tool.call({ operation: 'forget', key: 'temp' });

  expect(result.ok).toBe(true);
  expect(existsSync(safeJoin(home, 'memories', 'temp.md')!)).toBe(false);
  cleanup(home);
});

test('memory forget returns an error for a missing note', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const result = await tool.call({ operation: 'forget', key: 'missing' });

  expect(result.error).toContain('not found');
  cleanup(home);
});

test('memory list shows all notes with previews', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());
  await tool.call({ operation: 'remember', key: 'alpha', content: 'First note' });
  await tool.call({ operation: 'remember', key: 'beta', content: 'Second note' });

  const result = await tool.call({ operation: 'list' });

  const notes = result.notes as { key: string; preview: string }[];
  expect(notes.length).toBe(2);
  expect(notes.map(n => n.key).sort()).toEqual(['alpha', 'beta']);
  expect(notes.find(n => n.key === 'alpha')?.preview).toBe('First note');
  cleanup(home);
});

test('memory list returns an empty array when no notes exist', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const result = await tool.call({ operation: 'list' });

  expect(result.notes).toEqual([]);
  cleanup(home);
});

test('memory returns an error when no operation is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const result = await tool.call({} as { operation: string });

  expect(result.error).toContain('no operation provided');
  cleanup(home);
});

test('memory returns an error for an unknown operation', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const result = await tool.call({ operation: 'bogus' });

  expect(result.error).toContain('unknown operation');
  cleanup(home);
});

test('memory remember requires a key', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const result = await tool.call({ operation: 'remember', content: 'x' });

  expect(result.error).toBe('memory: no key provided for remember');
  cleanup(home);
});

test('memory remember requires content', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const result = await tool.call({ operation: 'remember', key: 'x' });

  expect(result.error).toBe('memory: no content provided for remember');
  cleanup(home);
});

test('memory recall requires a key', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());

  const result = await tool.call({ operation: 'recall' });

  expect(result.error).toBe('memory: no key provided for recall');
  cleanup(home);
});

test('memory overwrites an existing note on remember', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());
  await tool.call({ operation: 'remember', key: 'facts', content: 'old' });

  await tool.call({ operation: 'remember', key: 'facts', content: 'new' });

  const recalled = await tool.call({ operation: 'recall', key: 'facts' });
  expect(recalled.content).toBe('new');
  cleanup(home);
});

test('memory ignores existing files outside the memory dir', async () => {
  const { engine, home } = mockEngine();
  const tool = new MemoryTool(engine, new Logger());
  writeFileSync(join(home, 'notes.md'), 'not memory');

  const result = await tool.call({ operation: 'list' });

  expect(result.notes).toEqual([]);
  cleanup(home);
});
