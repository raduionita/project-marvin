import { readFileSync } from 'fs';

import { Tool, ToolMeta } from '../types.js';
import { isSafePath, readError, safeJoin } from '../helpers/index.js';
import logger from '../logger.js';
import * as constants from '../constants.js';

// TODO: add support for offset - see fs.readSync

export default class ReadFileTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'filesystem',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from disk.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to read.',
          },
        },
        required: ['path'],
      }
    },
  }

  public async call(args: { path: string }) {
    logger.debug('[ReadFileTool.call]', Object.keys(args));

    if (!args?.path) {
      return { error: 'read_file: no path provided' };
    }

    if (!isSafePath(args.path)) {
      return { error: `read_file: path "${args.path}" is outside the workspace (~/.marvin/files)` };
    }

    const path = safeJoin(this.engine.work, 'files', args.path);

    try {
      const content = readFileSync(path, 'utf-8');
      return { 
        path: args.path, 
        content: content.slice(0, constants.MAX_TOOL_RESULT_CHARS),
      };
    } catch (err) {
      logger.error('[ReadFileTool.call]', 'error:', readError(err));
      return { path: args.path, error: (err as Error).message };
    }
  }
}
