import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import AppendFileTool from './append_file.js';

function mockEngine(): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  const engine = new Engine(new Logger());
  engine.work = home;
  return { engine, home };
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

test('appendFile tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new AppendFileTool(engine, new Logger());
  expect(tool.meta.function.name).toBe('append_file');
  expect(tool.meta.function.parameters.required).toContain('path');
  expect(tool.meta.function.parameters.required).toContain('content');
  cleanup(engine.work);
});

test('appendFile appends to an existing file', async () => {
  const { engine, home } = mockEngine();
  const tool = new AppendFileTool(engine, new Logger());
  writeFileSync(join(home, 'notes.txt'), 'line one\n');

  const result = await tool.call({ path: 'notes.txt', content: 'line two\n' });

  expect(result.ok).toBe(true);
  expect(readFileSync(join(home, 'notes.txt'), 'utf-8')).toBe('line one\nline two\n');
  cleanup(home);
});

test('appendFile creates a new file when it does not exist', async () => {
  const { engine, home } = mockEngine();
  const tool = new AppendFileTool(engine, new Logger());

  const result = await tool.call({ path: 'created.txt', content: 'hello' });

  expect(result.ok).toBe(true);
  expect(readFileSync(join(home, 'created.txt'), 'utf-8')).toBe('hello');
  cleanup(home);
});

test('appendFile creates parent folders when missing', async () => {
  const { engine, home } = mockEngine();
  const tool = new AppendFileTool(engine, new Logger());

  const result = await tool.call({ path: 'journal/2026/aug.txt', content: 'entry' });

  expect(result.ok).toBe(true);
  expect(readFileSync(join(home, 'journal', '2026', 'aug.txt'), 'utf-8')).toBe('entry');
  cleanup(home);
});

test('appendFile rejects absolute paths outside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new AppendFileTool(engine, new Logger());

  const result = await tool.call({ path: '/etc/hosts', content: 'nope' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('appendFile rejects paths that escape via ..', async () => {
  const { engine, home } = mockEngine();
  const tool = new AppendFileTool(engine, new Logger());

  const result = await tool.call({ path: join(home, '..', 'escaped.txt'), content: 'nope' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('appendFile returns an error when no path is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new AppendFileTool(engine, new Logger());

  const result = await tool.call({ path: '', content: 'nope' });

  expect(result.error).toBe('append_file: no path provided');
  cleanup(home);
});

test('appendFile returns an error when no content is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new AppendFileTool(engine, new Logger());

  const result = await tool.call({ path: 'x.txt' } as { path: string; content: string });

  expect(result.error).toBe('append_file: no content provided');
  cleanup(home);
});