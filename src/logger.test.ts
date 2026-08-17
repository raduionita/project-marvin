import { test, expect } from 'bun:test';
import { Logger, logger, resolveLogLevel, shouldLog, LEVEL_PREFIXES, setLoggerMode, setDefaultOutput, LogMethod, LogOutput } from './logger.js';

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

test('LEVEL_PREFIXES matches the [LEVEL] format', () => {
  expect(LEVEL_PREFIXES).toEqual({ debug: '[DEBUG]', info: '[INFO]', warn: '[WARN]', error: '[ERROR]' });
});

test('Logger default level follows the env and filters debug', () => {
  const prev = process.env.MARVIN_LOG_LEVEL;
  try {
    delete process.env.MARVIN_LOG_LEVEL;

    const lines: { level: LogMethod; args: unknown[] }[] = [];
    const out: LogOutput = (level, args) => lines.push({ level, args });
    const lg = new Logger({ output: out });

    expect(lg.getLevel()).toBe('info');
    lg.debug('hidden');
    lg.info('shown');
    lg.warn('warned');

    expect(lines.map(l => l.level)).toEqual(['info', 'warn']);
    expect(lines[0]!.args[0]).toBe('shown');
  } finally {
    if (prev === undefined) {
      delete process.env.MARVIN_LOG_LEVEL;
    } else {
      process.env.MARVIN_LOG_LEVEL = prev;
    }
  }
});

test('Logger.setLevel toggles filtering at runtime', () => {
  const lines: { level: LogMethod; args: unknown[] }[] = [];
  const out: LogOutput = (level, args) => lines.push({ level, args });
  const lg = new Logger({ output: out, level: 'error' });

  lg.info('no');
  lg.error('yes');
  expect(lg.getLevel()).toBe('error');
  expect(lines.map(l => l.level)).toEqual(['error']);

  lg.setLevel('info');
  lg.info('now yes');
  expect(lines.map(l => l.level)).toEqual(['error', 'info']);
});

test('Logger.log is raw and never filtered', () => {
  const lines: { level: LogMethod; args: unknown[] }[] = [];
  const out: LogOutput = (level, args) => lines.push({ level, args });
  const lg = new Logger({ output: out, level: 'error' });

  lg.log('raw output');
  expect(lg.getLevel()).toBe('error');
  expect(lines).toEqual([{ level: 'log', args: ['raw output'] }]);
});

test('Logger.enablePrefix prefixes emitted lines with [LEVEL]', () => {
  const lines: { level: LogMethod; args: unknown[] }[] = [];
  const out: LogOutput = (level, args) => lines.push({ level, args });
  const lg = new Logger({ output: out, level: 'debug' });

  expect(lg.isPrefixEnabled()).toBe(false);
  lg.enablePrefix();
  expect(lg.isPrefixEnabled()).toBe(true);

  lg.debug('d');
  lg.info('i');
  lg.warn('w');

  expect(lines[0]!.args[0]).toBe('[DEBUG]');
  expect(lines[1]!.args[0]).toBe('[INFO]');
  expect(lines[2]!.args[0]).toBe('[WARN]');
  expect(lines[0]!.args[1]).toBe('d');

  lg.enablePrefix(false);
  expect(lg.isPrefixEnabled()).toBe(false);
});

test('Logger strips leading [ClassName.method] tags by default', () => {
  const lines: { level: LogMethod; args: unknown[] }[] = [];
  const out: LogOutput = (level, args) => lines.push({ level, args });
  const lg = new Logger({ output: out, level: 'info' });

  lg.info('[SlackChannel.onConnected]', 'connected!');
  lg.warn('[Marvin.execCommand]', 'unknown command:', 'foo');
  lg.error('[SlackChannel.onError]', new Error('boom'));

  expect(lines[0]!.args).toEqual(['connected!']);
  expect(lines[1]!.args).toEqual(['unknown command:', 'foo']);
  expect(lines[2]!.args[0]).toBeInstanceOf(Error);
});

test('Logger keeps [dry] markers when stripping tags', () => {
  const lines: { level: LogMethod; args: unknown[] }[] = [];
  const out: LogOutput = (level, args) => lines.push({ level, args });
  const lg = new Logger({ output: out, level: 'info' });

  lg.info('[InstallCommand.makeProject]', '[dry]', '/tmp/x');

  expect(lines[0]!.args).toEqual(['[dry]', '/tmp/x']);
});

test('Logger.setStripTags(false) keeps the tags', () => {
  const lines: { level: LogMethod; args: unknown[] }[] = [];
  const out: LogOutput = (level, args) => lines.push({ level, args });
  const lg = new Logger({ output: out, level: 'info' });

  expect(lg.isStripTags()).toBe(true);
  lg.setStripTags(false);
  expect(lg.isStripTags()).toBe(false);

  lg.info('[SlackChannel.onConnected]', 'connected!');

  expect(lines[0]!.args).toEqual(['[SlackChannel.onConnected]', 'connected!']);
});

test('setLoggerMode flips every Logger instance (daemon mode)', () => {
  const lines: { level: LogMethod; args: unknown[] }[] = [];
  const out: LogOutput = (level, args) => lines.push({ level, args });
  const lg = new Logger({ output: out, level: 'info' });

  setLoggerMode({ prefix: true, stripTags: false });
  try {
    expect(lg.isPrefixEnabled()).toBe(true);
    expect(lg.isStripTags()).toBe(false);

    lg.info('[SlackChannel.onConnected]', 'connected!');

    expect(lines[0]!.args).toEqual(['[INFO]', '[SlackChannel.onConnected]', 'connected!']);
  } finally {
    setLoggerMode({ prefix: false, stripTags: true });
  }
});

test('Logger uses the shared default output when no override is set', () => {
  const captured: unknown[][] = [];
  const prev = setDefaultOutput((_level, args) => { captured.push(args); });
  try {
    const lg = new Logger({ level: 'info' });
    lg.info('hello', 42);
  } finally {
    setDefaultOutput(prev);
  }

  expect(captured.length).toBe(1);
  expect(captured[0]).toEqual(['hello', 42]);
});

test('default exported logger is a Logger instance', () => {
  expect(logger).toBeInstanceOf(Logger);
  expect(logger.getLevel()).toBe(resolveLogLevel());
});
