import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import EditFileTool from './edit_file.js';

function mockEngine(): { engine: Engine; work: string, files: string } {
  const work = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  const files = join(work, 'files');
  mkdirSync(files);
  const engine = new Engine(new Logger());
  engine.work = work;
  return { engine, work, files };
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

function mockFile(work: string, name: string, contents: string): string {
  const path = join(work, name);
  writeFileSync(path, contents);
  return path;
}

test('editFile tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());
  const meta = tool.meta;
  expect(meta.function.name).toBe('edit_file');
  expect(meta.function.parameters.required).toContain('path');
  expect(meta.function.parameters.required).toContain('newString');
});

test('editFile replaces a snippet with oldString/newString', async () => {
  const { engine, work, files } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());
  mockFile(files, 'notes.txt', 'hello world');

  const result = await tool.call({ path: 'notes.txt', oldString: 'world', newString: 'there' });

  expect(result.ok).toBe(true);
  expect(readFileSync(join(files, 'notes.txt'), 'utf-8')).toBe('hello there');
  cleanup(work);
});

test('editFile replaces all occurrences of oldString', async () => {
  const { engine, work, files } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());
  mockFile(files, 'notes.txt', 'red blue red blue');

  await tool.call({ path: 'notes.txt', oldString: 'red', newString: 'green' });

  expect(readFileSync(join(files, 'notes.txt'), 'utf-8')).toBe('green blue green blue');
  cleanup(work);
});

test('editFile reports when oldString is not found', async () => {
  const { engine, work, files } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());
  mockFile(files, 'notes.txt', 'hello world');

  const result = await tool.call({ path: 'notes.txt', oldString: 'nope', newString: 'there' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('oldString not found');
  expect(readFileSync(join(files, 'notes.txt'), 'utf-8')).toBe('hello world');
  cleanup(work);
});

test('editFile creates a new file when only newString is provided', async () => {
  const { engine, work, files } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());

  const result = await tool.call({ path: 'created.txt', newString: 'brand new file' });

  expect(result.ok).toBe(true);
  expect(readFileSync(join(files, 'created.txt'), 'utf-8')).toBe('brand new file');
  cleanup(work);
});

test('editFile overwrites the whole file when oldString is omitted', async () => {
  const { engine, work, files } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());
  mockFile(files, 'notes.txt', 'old content');

  await tool.call({ path: 'notes.txt', newString: 'new content' });

  expect(readFileSync(join(files, 'notes.txt'), 'utf-8')).toBe('new content');
  cleanup(work);
});

test('editFile rejects absolute paths outside the workspace', async () => {
  const { engine, work } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());
  const outside = join(tmpdir(), 'marvin-outside-' + Date.now() + '.txt');

  const result = await tool.call({ path: outside, newString: 'nope' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  cleanup(work);
});

test('editFile rejects paths that escape via ..', async () => {
  const { engine, work } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());

  const result = await tool.call({ path: join(work, '..', 'escaped.txt'), newString: 'nope' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  cleanup(work);
});

test('editFile returns an error when no path is provided', async () => {
  const { engine, work } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());

  const result = await tool.call({ path: '', newString: 'nope' });

  expect(result.error).toBe('edit_file: no path provided');
  cleanup(work);
});

test('editFile returns an error when no newString is provided', async () => {
  const { engine, work } = mockEngine();
  const tool = new EditFileTool(engine, new Logger());

  const result = await tool.call({ path: 'x.txt' } as { path: string; newString?: string; oldString?: string });

  expect(result.error).toBe('edit_file: no newString provided');
  cleanup(work);
});
