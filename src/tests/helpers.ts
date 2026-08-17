import { Logger } from '../logger.js';

// a logger that captures every emitted line (info-level and up), so tests can
// assert on command output without patching console.*
export function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = new Logger({ level: 'info', output: (_level, args) => lines.push(args.map(String).join(' ')) });
  return { logger, lines };
}
