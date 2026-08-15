import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import ReadFileTool from './read_file.js';

function mockEngine(): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  const engine = new Engine(new Logger());
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

test('readFile tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new ReadFileTool(engine, new Logger());
  const meta = tool.meta;
  expect(meta.function.name).toBe('read_file');
  expect(meta.function.description).toContain('Read the contents of a file');
  expect(meta.function.parameters.required).toContain('path');
});

test('readFile returns the contents of a file inside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadFileTool(engine, new Logger());
  mockFile(home, 'sample.txt', 'hello world');

  const result = await tool.call({ path: 'sample.txt' });

  expect(result.path).toBe('sample.txt');
  expect(result.content).toBe('hello world');
  expect(result.error).toBeUndefined();

  cleanup(home);
});

test('readFile reads relative paths inside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadFileTool(engine, new Logger());
  mockFile(home, 'relative.txt', 'relative works');

  const result = await tool.call({ path: 'relative.txt' });

  expect(result.content).toBe('relative works');

  cleanup(home);
});

test('readFile rejects absolute paths outside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadFileTool(engine, new Logger());

  const result = await tool.call({ path: '/etc/hosts' });

  expect(result.content).toBeUndefined();
  expect(result.error).toContain('outside the workspace');

  cleanup(home);
});

test('readFile rejects paths that escape via ..', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadFileTool(engine, new Logger());

  const result = await tool.call({ path: join(home, '..', '..', 'etc', 'hosts') });

  expect(result.content).toBeUndefined();
  expect(result.error).toContain('outside the workspace');

  cleanup(home);
});

test('readFile returns an error for a missing file', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadFileTool(engine, new Logger());

  const result = await tool.call({ path: 'does-not-exist.txt' });

  expect(result.path).toBe('does-not-exist.txt');
  expect(typeof result.error).toBe('string');
  expect(result.content).toBeUndefined();

  cleanup(home);
});

test('readFile returns an error when no path is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadFileTool(engine, new Logger());

  const result = await tool.call({} as { path: string });

  expect(result.error).toBe('read_file: no path provided');

  cleanup(home);
});
