import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import ReloadCommand from './reload.js';

function buildEngine(envContent?: string): Engine {
  const engine = new Engine(new Logger());
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  if (envContent !== undefined) {
    writeFileSync(join(engine.work, '.env'), envContent);
  }
  return engine;
}

test('setLogLevel replaces a commented MARVIN_LOG_LEVEL line', () => {
  const engine = buildEngine('# marvin environment variables (systemd EnvironmentFile)\n# MARVIN_LOG_LEVEL=debug\n');
  const cmd = new ReloadCommand(engine, new Logger(), []);

  cmd.setLogLevel('warn');

  const content = readFileSync(join(engine.work, '.env'), 'utf8');
  expect(content).toContain('MARVIN_LOG_LEVEL=warn');
  expect(content).not.toContain('# MARVIN_LOG_LEVEL');
});

test('setLogLevel appends MARVIN_LOG_LEVEL when missing', () => {
  const engine = buildEngine('# just a comment\n');
  const cmd = new ReloadCommand(engine, new Logger(), []);

  cmd.setLogLevel('debug');

  const content = readFileSync(join(engine.work, '.env'), 'utf8');
  expect(content).toContain('MARVIN_LOG_LEVEL=debug');
  expect(content).toContain('# just a comment');
});

test('setLogLevel creates the .env file when missing', () => {
  const engine = buildEngine();
  const cmd = new ReloadCommand(engine, new Logger(), []);

  cmd.setLogLevel('info');

  const envPath = join(engine.work, '.env');
  expect(existsSync(envPath)).toBe(true);
  expect(readFileSync(envPath, 'utf8')).toContain('MARVIN_LOG_LEVEL=info');
});
