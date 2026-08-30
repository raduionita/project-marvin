import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import LogsCommand from './logs.js';
import { captureLogger } from '../tests.js';

function buildLogFile(lines: string[]): { engine: Engine; path: string } {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  const dir = join(engine.work, 'logs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'marvin.log');
  writeFileSync(path, lines.join('\n') + '\n');
  return { engine, path };
}

test('logs prints the default last 20 lines', async () => {
  const { engine, path } = buildLogFile(Array.from({ length: 30 }, (_, i) => `line ${i + 1}`));

  const { lines, restore } = captureLogger();
  const cmd = new LogsCommand(engine, []);
  await cmd.exec();

  expect(lines.length).toBe(20);
  expect(lines[0]).toBe('line 11');
  expect(lines[19]).toBe('line 30');
  restore();
});

test('logs honors -n <n>', async () => {
  const { engine, path } = buildLogFile(['a', 'b', 'c', 'd']);

  const { lines, restore } = captureLogger();
  const cmd = new LogsCommand(engine, ['-n', '2']);
  await cmd.exec();

  expect(lines).toEqual(['c', 'd']);
  restore();
});

test('logs errors when no log file exists', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));

  const { lines, restore } = captureLogger();
  const cmd = new LogsCommand(engine, []);
  await cmd.exec();

  expect(lines.some(l => l.includes('no log file found'))).toBe(true);
  restore();
});
