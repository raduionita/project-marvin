import { readFileSync } from 'fs';
import { Tool, ToolMeta } from '../types.js';
import { isSafePath, safeJoin } from '../helpers.js';

export default class ReadFileTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from disk (only inside the ~/.marvin workspace)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to read (must be inside ~/.marvin)',
          },
        },
        required: ['path'],
      }
    },
  }

  public async call(args: { path: string }) {
    this.logger.debug('[ReadFileTool.call]', Object.keys(args));

    if (!args?.path) {
      return { error: 'read_file: no path provided' };
    }

    if (!isSafePath(args.path)) {
      return { error: `read_file: path "${args.path}" is outside the workspace (~/.marvin)` };
    }

    const path = safeJoin(this.engine.work, args.path);

    try {
      const content = readFileSync(path, 'utf-8');
      return { path: args.path, content };
    } catch (err) {
      this.logger.error('[ReadFileTool.call]', 'error:', err);
      return { path: args.path, error: (err as Error).message };
    }
  }
}
