import { test, expect } from 'bun:test';
import { loadConsole, resolveLogLevel, setLogLevel, getLogLevel, shouldLog, enablePrefix, isPrefixEnabled, LEVEL_PREFIXES } from './logger.js';

test('resolveLogLevel reads MARVIN_LOG_LEVEL and falls back to default', () => {
  const prev = process.env.MARVIN_LOG_LEVEL;
  try {
    process.env.MARVIN_LOG_LEVEL = 'error';
    expect(resolveLogLevel()).toBe('error');

    delete process.env.MARVIN_LOG_LEVEL;
    expect(resolveLogLevel()).toBe('info');

    process.env.MARVIN_LOG_LEVEL = 'bogus' as any;
    expect(resolveLogLevel()).toBe('info');
  } finally {
    if (prev === undefined) {
      delete process.env.MARVIN_LOG_LEVEL;
    } else {
      process.env.MARVIN_LOG_LEVEL = prev;
    }
  }
});

test('shouldLog respects the level threshold', () => {
  expect(shouldLog('debug', 'info')).toBe(false);
  expect(shouldLog('info', 'info')).toBe(true);
  expect(shouldLog('warn', 'error')).toBe(false);
  expect(shouldLog('error', 'error')).toBe(true);
  expect(shouldLog('info', 'debug')).toBe(true);
});

test('loadConsole reads the level from the env', () => {
  const prev = process.env.MARVIN_LOG_LEVEL;
  try {
    delete process.env.MARVIN_LOG_LEVEL;
    expect(loadConsole()).toBe('info');
    expect(getLogLevel()).toBe('info');

    process.env.MARVIN_LOG_LEVEL = 'warn';
    expect(loadConsole()).toBe('warn');
    expect(getLogLevel()).toBe('warn');
  } finally {
    if (prev === undefined) {
      delete process.env.MARVIN_LOG_LEVEL;
    } else {
      process.env.MARVIN_LOG_LEVEL = prev;
    }
    loadConsole();
  }
});

test('console.setLogLevel + console.getLogLevel are attached and work', () => {
  loadConsole();
  console.setLogLevel('error');
  expect(console.getLogLevel()).toBe('error');
  expect(getLogLevel()).toBe('error');
  console.setLogLevel('info');
  expect(console.getLogLevel()).toBe('info');
});

test('console.enablePrefix toggles the [LEVEL] prefix and LEVEL_PREFIXES are correct', () => {
  loadConsole();
  expect(LEVEL_PREFIXES).toEqual({ debug: '[DEBUG]', info: '[INFO]', warn: '[WARN]', error: '[ERROR]' });
  expect(isPrefixEnabled()).toBe(false);
  console.enablePrefix();
  expect(isPrefixEnabled()).toBe(true);
  console.enablePrefix(false);
  expect(isPrefixEnabled()).toBe(false);
  enablePrefix(false);
});