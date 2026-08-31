import { unlinkSync } from 'fs';
import { Tool, ToolMeta } from '../types.js';
import { isSafePath, readError, safeJoin } from '../helpers/index.js';
import logger from '../logger.js';

export default class DeleteFileTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'filesystem',
    function: {
      name: 'delete_file',
      description: 'Delete a file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to delete.',
          },
        },
        required: ['path'],
      }
    },
  }

  public async call(args: { path: string }) {
    logger.debug('[DeleteFileTool.call]', 'path:', args.path);

    if (!args?.path) {
      return { error: 'delete_file: no path provided' };
    }

    if (!isSafePath(args.path)) {
      return { error: `delete_file: path "${args.path}" is outside the workspace (~/.marvin/files)` };
    }

    const path = safeJoin(this.engine.work, 'files',  args.path);

    try {
      unlinkSync(path);
      return { path: args.path, ok: true };
    } catch (err) {
      logger.error('[DeleteFileTool.call]', 'error:', readError(err));
      return { path: args.path, error: (err as Error).message };
    }
  }
}
