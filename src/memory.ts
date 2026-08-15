import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { safeJoin } from './helpers.js';

// memory storage helpers: ~/.marvin/memory/<key>.md files. Used by the
// memory tool and by the engine to build the system-prompt summary.

// sanitize a memory key into a safe file name (no path separators, no dots)
function sanitizeKey(key: string): string {
  return key.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^[-]+|[-]+$/g, '').toLowerCase();
}

export function saveMemory(work: string, key: string, content: string): { path: string } | { error: string } {
  const file = safeJoin(work, 'memories', `${sanitizeKey(key)}.md`);
  if (!file) {
    return { error: `memory: key "${key}" is not a valid memory key` };
  }
  const mpath = join(work, 'memories');
  mkdirSync(mpath, { recursive: true });
  writeFileSync(file, content.trim() + '\n', 'utf-8');
  return { path: file };
}

export function readMemory(work: string, key: string): { content: string } | { error: string } {
  const file = safeJoin(work, 'memories', `${sanitizeKey(key)}.md`);
  if (!file) {
    return { error: `memory: key "${key}" is not a valid memory key` };
  }
  try {
    return { content: readFileSync(file, 'utf-8').trim() };
  } catch {
    return { error: `memory: key "${key}" not found` };
  }
}

export function dropMemory(work: string, key: string): { ok: boolean } | { error: string } {
  const file = safeJoin(work, 'memories', `${sanitizeKey(key)}.md`);
  if (!file) {
    return { error: `memory: key "${key}" is not a valid memory key` };
  }
  try {
    unlinkSync(file);
    return { ok: true };
  } catch {
    return { error: `memory: key "${key}" not found` };
  }
}

export function listMemories(work: string): { key: string; preview: string }[] {
  const mpath = join(work, 'memories');
  try {
    return readdirSync(mpath)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const file = join(mpath, f);
        let preview = '';
        try {
          preview = readFileSync(file, 'utf-8').split('\n')[0]!.slice(0, 100);
        } catch {
          // unreadable file, empty preview
        }
        return { key: f.replace(/\.md$/, ''), preview };
      })
      .sort((a, b) => {
        // most recently updated first
        const at = statSync(join(mpath, `${a.key}.md`)).mtimeMs;
        const bt = statSync(join(mpath, `${b.key}.md`)).mtimeMs;
        return bt - at;
      });
  } catch {
    return [];
  }
}

// build a compact summary of the most recently updated memory notes, used in
// the system prompt. bounded: at most MAX_NOTES notes and MAX_CHARS total.
export function readMemorySummary(work: string, maxNotes = 10, maxChars = 2048): string {
  const notes = listMemories(work).slice(0, maxNotes);
  if (notes.length === 0) return '';

  const lines: string[] = [];
  for (const note of notes) {
    lines.push(`- ${note.key}: ${note.preview || '(empty)'}`);
  }

  let summary = lines.join('\n');
  if (summary.length > maxChars) {
    summary = summary.slice(0, maxChars) + '...';
  }
  return summary;
}
