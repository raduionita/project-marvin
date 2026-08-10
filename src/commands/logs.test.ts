import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Engine from '../engine.js';
import LogsCommand from './logs.js';

function buildLogFile(lines: string[]): { engine: Engine; path: string } {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  const path = join(engine.work, 'marvin.log');
  writeFileSync(path, lines.join('\n') + '\n');
  return { engine, path };
}

test('logs prints the default last 20 lines', async () => {
  const { engine, path } = buildLogFile(Array.from({ length: 30 }, (_, i) => `line ${i + 1}`));

  const printed: string[] = [];
  const orig = console.log;
  console.log = (...a: string[]) => { printed.push(a.join(' ')); };
  try {
    const cmd = new LogsCommand(engine, []);
    await cmd.exec();
  } finally {
    console.log = orig;
  }

  expect(printed.length).toBe(20);
  expect(printed[0]).toBe('line 11');
  expect(printed[19]).toBe('line 30');
});

test('logs honors -n <n>', async () => {
  const { engine, path } = buildLogFile(['a', 'b', 'c', 'd']);

  const printed: string[] = [];
  const orig = console.log;
  console.log = (...a: string[]) => { printed.push(a.join(' ')); };
  try {
    const cmd = new LogsCommand(engine, ['-n', '2']);
    await cmd.exec();
  } finally {
    console.log = orig;
  }

  expect(printed).toEqual(['c', 'd']);
});

test('logs errors when no log file exists', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));

  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: any[]) => { errors.push(a.join(' ')); };
  try {
    const cmd = new LogsCommand(engine, []);
    await cmd.exec();
  } finally {
    console.error = orig;
  }

  expect(errors.some(e => e.includes('no log file found'))).toBe(true);
});