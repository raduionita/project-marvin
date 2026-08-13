import { LogLevel } from './types.js';

export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

// prefix used when logger.enablePrefix(true) is set
export const LEVEL_PREFIXES: Record<LogLevel, string> = {
  debug: '[DEBUG]',
  info: '[INFO]',
  warn: '[WARN]',
  error: '[ERROR]',
};

// the levels a Logger can emit, including raw (unfiltered) log lines
export type LogMethod = 'log' | LogLevel;

// intercepts every emitted line instead of writing to the console
export type LogOutput = (level: LogMethod, args: unknown[]) => void;

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

// instance logger: debug/info/warn/error are level-filtered (and optionally
// prefixed with [LEVEL]); log is raw/unfiltered output (e.g. `marvin logs`).
// an `output` override (e.g. Slack) can capture lines instead of printing.
export class Logger {
  // undefined = resolve from MARVIN_LOG_LEVEL on every emit, so `--log-level`
  // (set at runtime in marvin.loadFlags) is honored without extra wiring
  private level: LogLevel | undefined;
  private prefixEnabled: boolean;
  private output: LogOutput;

  constructor(opts: { level?: LogLevel; prefix?: boolean; output?: LogOutput } = {}) {
    this.level = opts.level;
    this.prefixEnabled = opts.prefix ?? false;
    this.output = opts.output ?? ((level, args) => {
      console[level](...args);
    });
  }

  getLevel(): LogLevel {
    return this.level ?? resolveLogLevel();
  }

  setLevel(level: LogLevel): void {
    if (LOG_LEVELS[level] !== undefined) {
      this.level = level;
    }
  }

  enablePrefix(enabled: boolean = true): void {
    this.prefixEnabled = enabled;
  }

  isPrefixEnabled(): boolean {
    return this.prefixEnabled;
  }

  // raw output, never filtered (mirrors console.log)
  log(...args: unknown[]): void {
    this.output('log', args);
  }

  debug(...args: unknown[]): void {
    this.emit('debug', args);
  }

  info(...args: unknown[]): void {
    this.emit('info', args);
  }

  warn(...args: unknown[]): void {
    this.emit('warn', args);
  }

  error(...args: unknown[]): void {
    this.emit('error', args);
  }

  private emit(level: LogLevel, args: unknown[]) {
    if (!shouldLog(level, this.getLevel())) {
      return;
    }
    const out = this.prefixEnabled ? [LEVEL_PREFIXES[level], ...args] : args;
    this.output(level, out);
  }
}

// module-level logger for code without a class instance (e.g. helpers)
export const logger = new Logger();
export default logger;
