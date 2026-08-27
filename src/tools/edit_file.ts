import { readFileSync, writeFileSync } from 'fs';
import { Tool, ToolMeta } from '../types.js';
import { isSafePath, safeJoin } from '../helpers.js';

export default class EditFileTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file inside the `~/.marvin/files` folder: pass oldString + newString to replace a snippet, or just newString to create/overwrite the file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to edit (must be inside ~/.marvin/files)',
          },
          newString: {
            type: 'string',
            description: 'Replacement text, or the full file content when oldString is omitted',
          },
          oldString: {
            type: 'string',
            description: 'Text to replace (all occurrences). Omit to write the full content',
          },
        },
        required: ['path', 'newString'],
      }
    },
  }

  public async call(args: { path: string; newString?: string; oldString?: string }) {
    this.logger.debug('[EditFileTool.call]', Object.keys(args));

    if (!args?.path) {
      return { error: 'edit_file: no path provided' };
    }

    if (args.newString === undefined) {
      return { error: 'edit_file: no newString provided' };
    }

    if (!isSafePath(args.path)) {
      return { error: `edit_file: path "${args.path}" is outside the workspace (~/.marvin/files)` };
    }

    const path = safeJoin(this.engine.work, args.path);

    try {
      let content = args.newString;

      // snippet replace mode
      if (args.oldString !== undefined) {
        const current = readFileSync(path, 'utf-8');
        if (!current.includes(args.oldString)) {
          return { path: args.path, error: 'edit_file: oldString not found in file' };
        }
        content = current.split(args.oldString).join(args.newString);
      }

      writeFileSync(path, content, 'utf-8');

      return { path: args.path, ok: true };
    } catch (err) {
      this.logger.error('[EditFileTool.call]', 'error:', err);
      return { path: args.path, error: (err as Error).message };
    }
  }
}
