import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import EditFileTool from './edit_file.js';

function mockEngine(): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  const engine = new Engine();
  engine.work = home;
  return { engine, home };
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

function mockFile(home: string, name: string, contents: string): string {
  const path = join(home, name);
  writeFileSync(path, contents);
  return path;
}

test('editFile tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new EditFileTool(engine);
  const meta = tool.meta;
  expect(meta.function.name).toBe('edit_file');
  expect(meta.function.parameters.required).toContain('path');
  expect(meta.function.parameters.required).toContain('newString');
});

test('editFile replaces a snippet with oldString/newString', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);
  const path = mockFile(home, 'notes.txt', 'hello world');

  const result = await tool.call({ path, oldString: 'world', newString: 'there' });

  expect(result.ok).toBe(true);
  expect(readFileSync(path, 'utf-8')).toBe('hello there');
  cleanup(home);
});

test('editFile replaces all occurrences of oldString', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);
  const path = mockFile(home, 'notes.txt', 'red blue red blue');

  await tool.call({ path, oldString: 'red', newString: 'green' });

  expect(readFileSync(path, 'utf-8')).toBe('green blue green blue');
  cleanup(home);
});

test('editFile reports when oldString is not found', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);
  const path = mockFile(home, 'notes.txt', 'hello world');

  const result = await tool.call({ path, oldString: 'nope', newString: 'there' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('oldString not found');
  expect(readFileSync(path, 'utf-8')).toBe('hello world');
  cleanup(home);
});

test('editFile creates a new file when only newString is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);
  const path = join(home, 'created.txt');

  const result = await tool.call({ path, newString: 'brand new file' });

  expect(result.ok).toBe(true);
  expect(readFileSync(path, 'utf-8')).toBe('brand new file');
  cleanup(home);
});

test('editFile overwrites the whole file when oldString is omitted', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);
  const path = mockFile(home, 'notes.txt', 'old content');

  await tool.call({ path, newString: 'new content' });

  expect(readFileSync(path, 'utf-8')).toBe('new content');
  cleanup(home);
});

test('editFile rejects absolute paths outside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);
  const outside = join(tmpdir(), 'marvin-outside-' + Date.now() + '.txt');

  const result = await tool.call({ path: outside, newString: 'nope' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('editFile rejects paths that escape via ..', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);

  const result = await tool.call({ path: join(home, '..', 'escaped.txt'), newString: 'nope' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('editFile rejects a symlink that points outside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);
  const link = join(home, 'escape-link.txt');
  const outside = join(tmpdir(), 'marvin-symlink-target-' + Date.now() + '.txt');
  writeFileSync(outside, 'target');
  symlinkSync(outside, link);

  const result = await tool.call({ path: link, newString: 'nope' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  expect(readFileSync(outside, 'utf-8')).toBe('target');
  cleanup(home);
  rmSync(outside, { force: true });
});

test('editFile returns an error when no path is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);

  const result = await tool.call({ path: '', newString: 'nope' });

  expect(result.error).toBe('edit_file: no path provided');
  cleanup(home);
});

test('editFile returns an error when no newString is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new EditFileTool(engine);

  const result = await tool.call({ path: 'x.txt' } as { path: string; newString?: string; oldString?: string });

  expect(result.error).toBe('edit_file: no newString provided');
  cleanup(home);
});
