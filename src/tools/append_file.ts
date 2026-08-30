import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { Tool, ToolMeta } from '../types.js';
import { isSafePath, safeJoin } from '../helpers/index.js';

export default class AppendFileTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'filesystem',
    function: {
      name: 'append_file',
      description: 'Append text to the end of a file inside the `~/.marvin/files` folder. Creates the file (and parent folders) when it does not exist yet. Use for journaling, logs, or growing notes',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to append to (must be inside `~/.marvin/files`)',
          },
          content: {
            type: 'string',
            description: 'Text to append to the file',
          },
        },
        required: ['path', 'content'],
      }
    },
  }

  public async call(args: { path: string; content: string }) {
    this.logger.debug('[AppendFileTool.call]', Object.keys(args));

    if (!args?.path) {
      return { error: 'append_file: no path provided' };
    }

    if (args.content === undefined) {
      return { error: 'append_file: no content provided' };
    }

    if (!isSafePath(args.path)) {
      return { error: `append_file: path "${args.path}" is outside the workspace (~/.marvin/files)` };
    }

    const path = safeJoin(this.engine.work, 'files',  args.path);

    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, args.content, 'utf-8');
      return { path: args.path, ok: true };
    } catch (err) {
      this.logger.error('[AppendFileTool.call]', 'error:', err);
      return { path: args.path, error: (err as Error).message };
    }
  }
}
