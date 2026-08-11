import { LogLevel } from './types.js';

export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

// prefix used when console.enablePrefix(true) is set
export const LEVEL_PREFIXES: Record<LogLevel, string> = {
  debug: '[DEBUG]',
  info: '[INFO]',
  warn: '[WARN]',
  error: '[ERROR]',
};

let currentLevel: LogLevel = DEFAULT_LOG_LEVEL;
let prefixEnabled = false;

// keep the native console methods for passthrough
const native = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function setLogLevel(level: LogLevel): void {
  if (LOG_LEVELS[level] !== undefined) {
    currentLevel = level;
  }
}

export function enablePrefix(enabled: boolean = true): void {
  prefixEnabled = enabled;
}

export function isPrefixEnabled(): boolean {
  return prefixEnabled;
}

// would a message at `level` be emitted when the logger is at `current`?
export function shouldLog(level: LogLevel, current: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[current];
}

// resolve the effective level: env var (MARVIN_LOG_LEVEL) > default
export function resolveLogLevel(): LogLevel {
  const env = process.env.MARVIN_LOG_LEVEL as LogLevel | undefined;
  if (env && LOG_LEVELS[env] !== undefined) {
    return env;
  }
  return DEFAULT_LOG_LEVEL;
}

// emit one log line through the native console, honoring level + prefix
function emit(level: LogLevel, args: unknown[]) {
  if (!shouldLog(level, currentLevel)) {
    return;
  }
  const out = prefixEnabled ? [LEVEL_PREFIXES[level], ...args] : args;
  native[level](...out);
}

// replace console.debug/info/warn/error with level-filtered (and optionally
// prefixed) versions, and expose runtime controls on console.
// console.log is left untouched (used for raw output, e.g. marvin logs).
export function loadConsole(): LogLevel {
  currentLevel = resolveLogLevel();

  console.debug = (...args: unknown[]) => emit('debug', args);
  console.info = (...args: unknown[]) => emit('info', args);
  console.warn = (...args: unknown[]) => emit('warn', args);
  console.error = (...args: unknown[]) => emit('error', args);

  // runtime controls
  console.setLogLevel = (level: LogLevel) => setLogLevel(level);
  console.getLogLevel = () => getLogLevel();
  console.enablePrefix = (enabled: boolean = true) => enablePrefix(enabled);

  return currentLevel;
}

// programmatic logging that honors level + prefix (bypasses the console wrappers)
export function log(level: LogLevel, ...args: unknown[]): void {
  emit(level, args);
}

declare global {
  interface Console {
    setLogLevel(level: LogLevel): void;
    getLogLevel(): LogLevel;
    enablePrefix(enabled?: boolean): void;
  }
}