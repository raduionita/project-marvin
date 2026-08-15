import { readFileSync } from 'fs';
import { join } from 'path';
import { Tool, ToolMeta } from '../types.js';

const DEFAULT_LINES = 20;

export default class ReadLogsTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'read_logs',
      description: 'Read the last N lines (default 20) of the marvin daemon log file (~/.marvin/logs/marvin.log). Use it to inspect recent activity, errors, or what the assistant did',
      parameters: {
        type: 'object',
        properties: {
          lines: {
            type: 'number',
            description: 'How many lines to read from the end of the log (default 20, max 200)',
          },
        },
        required: [],
      }
    },
  }

  public async call(args: { lines?: number }) {
    this.logger.debug('[ReadLogsTool.call]', args);

    const lines = Math.min(Math.max(args?.lines || DEFAULT_LINES, 1), 200);
    const logPath = join(this.engine.work, 'logs', 'marvin.log');

    try {
      const content = readFileSync(logPath, 'utf-8');
      const all = content.split('\n').filter(l => l.trim().length > 0);
      const tail = all.slice(-lines);
      return { path: logPath, lines: tail.length, entries: tail };
    } catch (err) {
      this.logger.error('[ReadLogsTool.call]', 'error:', err);
      return { path: logPath, error: (err as Error).message };
    }
  }
}