import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Tool, ToolMeta } from '../types.js';
import { isSafePath, safeJoin } from '../helpers.js';

export default class ListFilesTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List the files and folders inside a directory of the `~/.marvin/files` folder. Omit "path" to list the workspace root, or pass a relative path. Optionally filter entries by a regex "pattern" matched against the entry name',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path of the directory to list (must be inside ~/.marvin/files). Omit for the workspace root',
          },
          pattern: {
            type: 'string',
            description: 'Optional regex matched against entry names to filter the listing',
          },
        },
        required: [],
      }
    },
  }

  public async call(args: { path?: string; pattern?: string }) {
    this.logger.debug('[ListFilesTool.call]', Object.keys(args));

    if (!isSafePath(args?.path || '.')) {
      return { error: `list_files: path "${args?.path || '.'}" is outside the workspace (~/.marvin/files)` };
    }

    const dir = safeJoin(this.engine.work, 'files', args?.path || '.');

    let regex: RegExp | null = null;
    if (args?.pattern) {
      try {
        regex = new RegExp(args.pattern);
      } catch (err) {
        return { error: `list_files: invalid pattern "${args.pattern}": ${(err as Error).message}` };
      }
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter(e => !regex || regex.test(e.name))
        .map(e => {
          const full = join(dir, e.name);
          const entry: { name: string; type: string; size?: number } = {
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
          };
          if (e.isFile()) {
            try {
              entry.size = statSync(full).size;
            } catch {
              // unreadable entry, size omitted
            }
          }
          return entry;
        })
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));

      return { path: args?.path || '.', count: entries.length, entries };
    } catch (err) {
      this.logger.error('[ListFilesTool.call]', 'error:', err);
      return { path: args?.path || '.', error: (err as Error).message };
    }
  }
}
