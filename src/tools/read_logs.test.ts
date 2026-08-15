import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import ReadLogsTool from './read_logs.js';

function mockEngine(): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  const engine = new Engine(new Logger());
  engine.work = home;
  return { engine, home };
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

function mockLog(home: string, lines: string[]): string {
  const dir = join(home, 'logs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'marvin.log');
  writeFileSync(path, lines.join('\n'));
  return path;
}

test('readLogs tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new ReadLogsTool(engine, new Logger());
  expect(tool.meta.function.name).toBe('read_logs');
  cleanup(engine.work);
});

test('readLogs returns the last 20 lines by default', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadLogsTool(engine, new Logger());
  const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`);
  const path = mockLog(home, lines);

  const result = await tool.call({});

  expect(result.path).toBe(path);
  expect(result.lines).toBe(20);
  const entries = result.entries as string[];
  expect(entries.length).toBe(20);
  expect(entries[0]).toBe('line-10');
  expect(entries[entries.length - 1]).toBe('line-29');
  cleanup(home);
});

test('readLogs returns all lines when the log is shorter than the default', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadLogsTool(engine, new Logger());
  mockLog(home, ['a', 'b', 'c']);

  const result = await tool.call({});

  expect(result.lines).toBe(3);
  expect(result.entries).toEqual(['a', 'b', 'c']);
  cleanup(home);
});

test('readLogs honors a custom line count', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadLogsTool(engine, new Logger());
  mockLog(home, Array.from({ length: 50 }, (_, i) => `line-${i}`));

  const result = await tool.call({ lines: 5 });

  expect(result.lines).toBe(5);
  expect(result.entries).toEqual(['line-45', 'line-46', 'line-47', 'line-48', 'line-49']);
  cleanup(home);
});

test('readLogs caps the requested lines at 200', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadLogsTool(engine, new Logger());
  mockLog(home, Array.from({ length: 300 }, (_, i) => `line-${i}`));

  const result = await tool.call({ lines: 500 });

  expect(result.lines).toBe(200);
  cleanup(home);
});

test('readLogs returns an error when the log file does not exist', async () => {
  const { engine, home } = mockEngine();
  const tool = new ReadLogsTool(engine, new Logger());

  const result = await tool.call({});

  expect(typeof result.error).toBe('string');
  expect(result.entries).toBeUndefined();
  cleanup(home);
});