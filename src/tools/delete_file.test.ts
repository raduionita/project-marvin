import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import DeleteFileTool from './delete_file.js';
import MoveFileTool from './move_file.js';

function mockEngine(): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  const engine = new Engine(new Logger());
  engine.work = home;
  return { engine, home };
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

test('deleteFile tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new DeleteFileTool(engine, new Logger());
  expect(tool.meta.function.name).toBe('delete_file');
  expect(tool.meta.function.parameters.required).toContain('path');
  cleanup(engine.work);
});

test('deleteFile deletes a file inside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new DeleteFileTool(engine, new Logger());
  writeFileSync(join(home, 'notes.txt'), 'hello');

  const result = await tool.call({ path: 'notes.txt' });

  expect(result.ok).toBe(true);
  expect(existsSync(join(home, 'notes.txt'))).toBe(false);
  cleanup(home);
});

test('deleteFile rejects absolute paths outside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new DeleteFileTool(engine, new Logger());

  const result = await tool.call({ path: '/etc/hosts' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('deleteFile rejects paths that escape via ..', async () => {
  const { engine, home } = mockEngine();
  const tool = new DeleteFileTool(engine, new Logger());

  const result = await tool.call({ path: join(home, '..', 'escaped.txt') });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('deleteFile returns an error when no path is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new DeleteFileTool(engine, new Logger());

  const result = await tool.call({ path: '' });

  expect(result.error).toBe('delete_file: no path provided');
  cleanup(home);
});

test('deleteFile returns an error for a missing file', async () => {
  const { engine, home } = mockEngine();
  const tool = new DeleteFileTool(engine, new Logger());

  const result = await tool.call({ path: 'does-not-exist.txt' });

  expect(typeof result.error).toBe('string');
  cleanup(home);
});

test('moveFile tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new MoveFileTool(engine, new Logger());
  expect(tool.meta.function.name).toBe('move_file');
  expect(tool.meta.function.parameters.required).toContain('path');
  expect(tool.meta.function.parameters.required).toContain('newPath');
  cleanup(engine.work);
});

test('moveFile renames a file inside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new MoveFileTool(engine, new Logger());
  writeFileSync(join(home, 'notes.txt'), 'hello');

  const result = await tool.call({ path: 'notes.txt', newPath: 'renamed.txt' });

  expect(result.ok).toBe(true);
  expect(existsSync(join(home, 'notes.txt'))).toBe(false);
  expect(existsSync(join(home, 'renamed.txt'))).toBe(true);
  cleanup(home);
});

test('moveFile moves a file into a subfolder', async () => {
  const { engine, home } = mockEngine();
  const tool = new MoveFileTool(engine, new Logger());
  writeFileSync(join(home, 'notes.txt'), 'hello');

  const result = await tool.call({ path: 'notes.txt', newPath: 'archive/notes.txt' });

  expect(result.ok).toBe(true);
  expect(existsSync(join(home, 'archive', 'notes.txt'))).toBe(true);
  cleanup(home);
});

test('moveFile rejects a destination outside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new MoveFileTool(engine, new Logger());
  writeFileSync(join(home, 'notes.txt'), 'hello');

  const result = await tool.call({ path: 'notes.txt', newPath: '/etc/notes.txt' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  expect(existsSync(join(home, 'notes.txt'))).toBe(true);
  cleanup(home);
});

test('moveFile rejects a source outside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new MoveFileTool(engine, new Logger());

  const result = await tool.call({ path: '/etc/hosts', newPath: 'hosts.txt' });

  expect(result.ok).toBeUndefined();
  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('moveFile returns an error when no path is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new MoveFileTool(engine, new Logger());

  const result = await tool.call({ path: '', newPath: 'x.txt' });

  expect(result.error).toBe('move_file: no path provided');
  cleanup(home);
});

test('moveFile returns an error when no newPath is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new MoveFileTool(engine, new Logger());

  const result = await tool.call({ path: 'x.txt' } as { path: string; newPath: string });

  expect(result.error).toBe('move_file: no newPath provided');
  cleanup(home);
});