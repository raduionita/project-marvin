import { readFileSync } from 'fs';
import { join } from 'path';
import { Tool, ToolMeta } from '../types.js';
import { readError, safeJoin } from '../helpers/index.js';
import logger from '../logger.js';

const DEFAULT_LINES = 20;

export default class ReadLogsTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'marvin',
    function: {
      name: 'read_logs',
      description: 'Read the last N lines (default 20) of the a `marvin.log` file.',
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
    logger.debug('[ReadLogsTool.call]', Object.keys(args));

    const file = 'marvin.log';
    const lines = Math.min(Math.max(args?.lines || DEFAULT_LINES, 1), 200);
    const logPath = safeJoin(this.engine.work, 'logs', file);

    try {
      const content = readFileSync(logPath, 'utf-8');
      const all = content.split('\n').filter(l => l.trim().length > 0);
      const tail = all.slice(-lines);
      return { 
        path: logPath, 
        lines: tail.length, 
        entries: tail
      };
    } catch (err) {
      logger.error('[ReadLogsTool.call]', 'error:', readError(err));
      return { path: logPath, error: (err as Error).message };
    }
  }
}
