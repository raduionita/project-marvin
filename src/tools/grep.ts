import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { Tool, ToolMeta } from '../types.js';
import { isSafePath, safeJoin } from '../helpers.js';

const MAX_MATCHES = 100;
const MAX_FILE_SIZE = 1024 * 1024; // skip files larger than 1MB

// binary detection: null byte in the first chunk
function isBinary(content: string): boolean {
  return content.includes('\0');
}

export default class GrepTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search the contents of files inside the ~/.marvin workspace for a regex pattern. Returns up to 100 matches with file paths and line numbers. Omit "path" to search the whole workspace, or pass a relative path to search a subdirectory or a single file',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex to search for (case-sensitive by default)',
          },
          path: {
            type: 'string',
            description: 'Optional relative path of the file or directory to search (must be inside ~/.marvin). Omit to search the workspace root',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Optional, default true. Set to false for case-insensitive matching',
          },
        },
        required: ['pattern'],
      }
    },
  }

  public async call(args: { pattern: string; path?: string; caseSensitive?: boolean }) {
    this.logger.debug('[GrepTool.call]', Object.keys(args));

    if (!args?.pattern) {
      return { error: 'grep: no pattern provided' };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.caseSensitive === false ? 'i' : '');
    } catch (err) {
      return { error: `grep: invalid pattern "${args.pattern}": ${(err as Error).message}` };
    }

    if (!isSafePath(args?.path || '.')) {
      return { error: `grep: path "${args?.path || '.'}" is outside the workspace (~/.marvin)` };
    }

    const target = safeJoin(this.engine.work, args?.path || '.');

    const matches: { file: string; lineNumber: number; line: string }[] = [];

    const walk = (dir: string) => {
      if (matches.length >= MAX_MATCHES) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (matches.length >= MAX_MATCHES) return;
        const full = join(dir, entry.name);

        if (entry.isDirectory()) {
          // never descend into hidden folders or node_modules
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }

        if (!entry.isFile()) continue;
        // skip known binary/large extensions
        const ext = extname(entry.name).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz'].includes(ext)) continue;

        try {
          if (statSync(full).size > MAX_FILE_SIZE) continue;
          const content = readFileSync(full, 'utf-8');
          if (isBinary(content)) continue;

          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_MATCHES) break;
            if (regex.test(lines[i]!)) {
              matches.push({ file: full, lineNumber: i + 1, line: lines[i]!.trim().slice(0, 200) });
            }
          }
        } catch {
          // unreadable file, skip
        }
      }
    };

    // single file, not a directory
    if (statSync(target).isFile()) {
      try {
        if (statSync(target).size <= MAX_FILE_SIZE) {
          const content = readFileSync(target, 'utf-8');
          if (!isBinary(content)) {
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
              if (regex.test(lines[i]!)) {
                matches.push({ file: target, lineNumber: i + 1, line: lines[i]!.trim().slice(0, 200) });
              }
            }
          }
        }
      } catch {
        // unreadable
      }
    } else {
      walk(target);
    }

    return {
      path: args?.path || '.',
      pattern: args.pattern,
      count: matches.length,
      truncated: matches.length >= MAX_MATCHES,
      matches,
    };
  }
}