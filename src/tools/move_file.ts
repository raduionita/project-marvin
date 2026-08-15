import { mkdirSync, renameSync } from 'fs';
import { dirname } from 'path';
import { Tool, ToolMeta } from '../types.js';
import { isSafePath, safeJoin } from '../helpers.js';

export default class MoveFileTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'move_file',
      description: 'Move or rename a file or folder inside the ~/.marvin workspace. Both the source and the destination must be inside ~/.marvin',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path of the file or folder to move (must be inside ~/.marvin)',
          },
          newPath: {
            type: 'string',
            description: 'Destination path (must be inside ~/.marvin)',
          },
        },
        required: ['path', 'newPath'],
      }
    },
  }

  public async call(args: { path: string; newPath: string }) {
    this.logger.debug('[MoveFileTool.call]', args);

    if (!args?.path) {
      return { error: 'move_file: no path provided' };
    }

    if (!args?.newPath) {
      return { error: 'move_file: no newPath provided' };
    }

    if (!isSafePath(args.path)) {
      return { error: `move_file: path "${args.path}" is outside the workspace (~/.marvin)` };
    }

    if (!isSafePath(args.newPath)) {
      return { error: `move_file: newPath "${args.newPath}" is outside the workspace (~/.marvin)` };
    }

    const path = safeJoin(this.engine.work, args.path);
    const newPath = safeJoin(this.engine.work, args.newPath);

    try {
      mkdirSync(dirname(newPath), { recursive: true });
      renameSync(path, newPath);
      return { path: args.path, newPath: args.newPath, ok: true };
    } catch (err) {
      this.logger.error('[MoveFileTool.call]', 'error:', err);
      return { path: args.path, newPath: args.newPath, error: (err as Error).message };
    }
  }
}