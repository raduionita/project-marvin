import { existsSync, lstatSync, realpathSync } from 'fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path';
import { readdirSync } from 'fs';
import TurndownService from 'turndown';

import logger from '../logger.js';

export function tryJsonParse<T>(str: string): T {
  try {
    return JSON.parse(str) as T;
  } catch (error) {
    logger.warn('[tryJsonParse]', `"${str}"`, (error as Error).message);
    return {} as T;
  }
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Deep merge: defaults fill in missing keys, incoming values win. Used to
// combine DEFAULT_CONFIG with a parsed marvin.json so missing sections
// (integrations, channels, ...) never end up undefined.
export function mergeConfig<T>(defaults: T, incoming: any): T {
  const out: any = { ...defaults };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])
    ) {
      out[key] = mergeConfig(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

// retry an async call a few times on failure, with a short backoff between
// attempts. used for transient failures (timeouts, 5xx, network hiccups).
export async function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; delayMs?: number; shouldRetry?: (err: unknown) => boolean } = {}): Promise<T> {
  const { retries = 2, delayMs = 500 } = opts;
  const shouldRetry = opts.shouldRetry || (() => true);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) break;
      await delay(delayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

export function rand(min:number, max:number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// clip a string to a maximum length, appending a marker when truncated
export function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  return text.slice(0, max) + `...[truncated ${text.length - max} chars]`;
}

// llm function names must match ^[a-zA-Z0-9_-]+$: map anything else to _
export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// flatten mcp result content blocks into a plain object: text blocks join into
// .text, other block types (image, audio, resource) are kept under their type
export function flattenContent(content: unknown): { [key: string]: any } {
  const out: { [key: string]: any } = {};
  const texts: string[] = [];
  for (const block of (Array.isArray(content) ? content : []) as { type: string, text?: string }[]) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    } else {
      (out[block.type] ||= []).push(block);
    }
  }
  if (texts.length) out.text = texts.join('\n');
  return out;
}

export function getRootDir() {
  return import.meta.dirname.replace(/\/src.*/, '')
}

// safe version of join, that guards against escaping via `..`, absolute paths, and symlinks
export function safeJoin(...values: string[]) {
  const joined = join(...values).split('..').filter(s => s).join('').split(sep).filter(s => s).join(sep);
  return joined.startsWith(sep) ? joined : sep + joined;
}

// validate a user-supplied path before it reaches safeJoin: only relative
// paths without `..` segments are allowed inside the workspace
export function isSafePath(path: string): boolean {
  if (!path || isAbsolute(path)) return false;
  return !path.split(sep).includes('..');
}

// Convert markdown to Slack mrkdwn so LLM output renders in Slack. Code blocks
// and inline code pass through untouched (mrkdwn uses the same syntax);
// headers become bold, **bold** -> *bold*, *italic* -> _italic_,
// [text](url) -> <url|text>, - lists -> • lists.
export function markdownToMrkdwn(markdown: string): string {
  if (!markdown) return markdown;

  const lines = markdown.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // fenced code blocks pass through untouched
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      out.push(line);
      continue;
    }
    if (inCodeBlock) {
      out.push(line);
      continue;
    }

    let text = line;

    // unordered list -> bullet
    text = text.replace(/^\s*[-*+]\s+/, '• ');

    // headers -> bold (content is formatted inline first)
    const header = text.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (header) {
      text = `*${formatInline(header[1]!)}*`;
    } else {
      text = formatInline(text);
    }

    out.push(text);
  }

  return out.join('\n');
}

// inline markdown -> mrkdwn: links, bold, italic, strikethrough. inline code
// spans are protected so formatting inside them is never touched.
function formatInline(text: string): string {
  // protect inline code spans from the formatting below
  const codeSpans: string[] = [];
  text = text.replace(/`[^`\n]+`/g, (m) => {
    codeSpans.push(m);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  // links [text](url) -> <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<$2|$1>');

  // bold/italic/strikethrough in one pass (bold wins over italic)
  text = text.replace(
    /\*\*([^*]+)\*\*|(?<!\*)\*([^*\n]+)\*(?!\*)|~~([^~]+)~~/g,
    (m, bold: string, italic: string, strike: string) => {
      if (bold) return `*${bold}*`;
      if (italic) return `_${italic}_`;
      if (strike) return `~${strike}~`;
      return m;
    }
  );

  // restore inline code spans
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codeSpans[Number(i)]!);

  return text;
}

// split a tool name back into { mcpId, toolName }, or null when the name is
// not an mcp tool
export function splitMcpToolName(name: string): { id: string, name: string } | null {
  const idx = name.lastIndexOf('__');
  if (idx <= 0 || idx === name.length - 2) return null;
  return { id: name.slice(0, idx), name: name.slice(idx + 2) };
}

// split a tool name back into { integrationId, action }, or null when the name
// is not an integration tool
export function splitIntegrationToolName(name: string): { id: string, action: string } | null {
  const idx = name.lastIndexOf('__');
  if (idx <= 0 || idx === name.length - 2) return null;
  return { id: name.slice(0, idx), action: name.slice(idx + 2) };
}

export function readError(error: unknown): string {
  if (error instanceof Error) {
    const lines = error.stack?.split('\n');
    if (lines && lines.length > 0) {
      return error.message + ' ' + (lines[0] || 'N/A');
    }
    return error.message;
  }
  return error?.toString() || 'N/A';
}
