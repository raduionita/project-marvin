import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import GrepTool from './grep.js';

function mockEngine(): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  const engine = new Engine(new Logger());
  engine.work = realpathSync(home);
  return { engine, home };
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

test('grep tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new GrepTool(engine, new Logger());
  expect(tool.meta.function.name).toBe('grep');
  expect(tool.meta.function.parameters.required).toContain('pattern');
  cleanup(engine.work);
});

test('grep finds matches with line numbers', async () => {
  const { engine, home } = mockEngine();
  const tool = new GrepTool(engine, new Logger());
  writeFileSync(join(home, 'notes.txt'), 'hello world\nsecond line\nhello again');

  const result = await tool.call({ pattern: 'hello' });
  const matches = result.matches as { file: string; lineNumber: number; line: string }[];

  expect(result.count).toBe(2);
  expect(matches.length).toBe(2);
  expect(matches[0]?.file).toBe(join(engine.work, 'notes.txt'));
  expect(matches[0]?.lineNumber).toBe(1);
  expect(matches[1]?.lineNumber).toBe(3);
  expect(result.truncated).toBe(false);
  cleanup(home);
});

test('grep searches a subdirectory recursively', async () => {
  const { engine, home } = mockEngine();
  const tool = new GrepTool(engine, new Logger());
  mkdirSync(join(home, 'agents', 'agent-1'), { recursive: true });
  writeFileSync(join(home, 'agents', 'agent-1', 'IDENTITY.md'), 'You are the assistant');
  writeFileSync(join(home, 'readme.txt'), 'no match here');

  const result = await tool.call({ pattern: 'assistant', path: 'agents' });
  const matches = result.matches as { file: string }[];

  expect(result.count).toBe(1);
  expect(matches[0]?.file).toContain('IDENTITY.md');
  cleanup(home);
});

test('grep supports case-insensitive matching', async () => {
  const { engine, home } = mockEngine();
  const tool = new GrepTool(engine, new Logger());
  writeFileSync(join(home, 'notes.txt'), 'HELLO world');

  const strict = await tool.call({ pattern: 'hello' });
  expect(strict.count).toBe(0);

  const loose = await tool.call({ pattern: 'hello', caseSensitive: false });
  expect(loose.count).toBe(1);
  cleanup(home);
});

test('grep rejects an invalid pattern', async () => {
  const { engine, home } = mockEngine();
  const tool = new GrepTool(engine, new Logger());

  const result = await tool.call({ pattern: '[' });

  expect(result.error).toContain('invalid pattern');
  cleanup(home);
});

test('grep returns an error when no pattern is provided', async () => {
  const { engine, home } = mockEngine();
  const tool = new GrepTool(engine, new Logger());

  const result = await tool.call({ pattern: '' });

  expect(result.error).toBe('grep: no pattern provided');
  cleanup(home);
});

test('grep rejects absolute paths outside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new GrepTool(engine, new Logger());

  const result = await tool.call({ pattern: 'x', path: '/etc' });

  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('grep rejects paths that escape via ..', async () => {
  const { engine, home } = mockEngine();
  const tool = new GrepTool(engine, new Logger());

  const result = await tool.call({ pattern: 'x', path: join(home, '..', 'etc') });

  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});
