import { unlinkSync } from 'fs';
import { Tool, ToolMeta } from '../types.js';
import { isSafePath, safeJoin } from '../helpers/index.js';

export default class DeleteFileTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'filesystem',
    function: {
      name: 'delete_file',
      description: 'Delete a file inside the `~/.marvin/files` folder. Only files can be deleted, not folders',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to delete (must be inside `~/.marvin/files`)',
          },
        },
        required: ['path'],
      }
    },
  }

  public async call(args: { path: string }) {
    this.logger.debug('[DeleteFileTool.call]', Object.keys(args));

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
      this.logger.error('[DeleteFileTool.call]', 'error:', err);
      return { path: args.path, error: (err as Error).message };
    }
  }
}
