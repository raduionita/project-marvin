import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

import type Engine from './engine.js';
import * as constants from './constants.js';
import { safeJoin } from './helpers.js';

// memory storage helpers: per-agent notes in ~/.marvin/memories/<agent-id>/<key>.md.
// Used by the memory tool and by the agent to build the system-prompt summary.

// sanitize a memory key into a safe file name (no path separators, no dots)
function sanitizeKey(key: string): string {
  return key.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^[-]+|[-]+$/g, '').toLowerCase();
}

// resolve the file for a memory note: <work>/memories/<agent-id>/<key>.md
function memoryFile(engine: Engine, agentId: string, key: string): string | undefined {
  const agent = sanitizeKey(agentId);
  if (!agent) {
    return undefined;
  }
  return safeJoin(engine.work, constants.MEMORIES_FOLDER, agent, `${sanitizeKey(key)}.md`);
}

export function saveMemory(engine: Engine, agentId: string, key: string, content: string): { path: string } | { error: string } {
  const file = memoryFile(engine, agentId, key);
  if (!file) {
    return { error: `memory: key "${key}" is not a valid memory key` };
  }
  mkdirSync(join(engine.work, constants.MEMORIES_FOLDER, sanitizeKey(agentId)), { recursive: true });
  writeFileSync(file, content.trim() + '\n', 'utf-8');
  return { path: file };
}

export function readMemory(engine: Engine, agentId: string, key: string): { content: string } | { error: string } {
  const file = memoryFile(engine, agentId, key);
  if (!file) {
    return { error: `memory: key "${key}" is not a valid memory key` };
  }
  try {
    return { content: readFileSync(file, 'utf-8').trim() };
  } catch {
    return { error: `memory: key "${key}" not found` };
  }
}

export function dropMemory(engine: Engine, agentId: string, key: string): { ok: boolean } | { error: string } {
  const file = memoryFile(engine, agentId, key);
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

export function listMemories(engine: Engine, agentId: string): { key: string; preview: string }[] {
  const agent = sanitizeKey(agentId);
  const mpath = join(engine.work, constants.MEMORIES_FOLDER, agent);
  if (!agent) {
    return [];
  }
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

// build a compact summary of the most recently updated memory notes for this
// agent, used in the system prompt. bounded: at most MAX_NOTES and MAX_CHARS.
export function readMemorySummary(engine: Engine, agentId: string, maxNotes = 10, maxChars = 2048): string {
  const notes = listMemories(engine, agentId).slice(0, maxNotes);
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
