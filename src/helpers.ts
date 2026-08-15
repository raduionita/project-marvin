import { existsSync, lstatSync, realpathSync } from 'fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path';
import { readdirSync } from 'fs';

import logger from './logger.js';

export function tryJsonParse<T>(str: string): T {
  try {
    return JSON.parse(str) as T;
  } catch (error) {
    logger.warn('[tryJsonParse]', `"${str}"`, error);
    return {} as T;
  }
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

export function getRootDir() {
  return import.meta.dirname.replace(/\/src.*/, '')
}

// Extract the natural-language string out of an LLM JSON output
// (e.g. {"output": "the answer"}). Falls back to the raw content unchanged
// when it is not a JSON object, so plain-text replies still pass through.
export function extractOutput(content: string): string {
  if (!content) return content;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }

  if (typeof parsed === 'string') return parsed;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return content;

  for (const key of ['output', 'text', 'answer', 'content', 'message']) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  return content;
}

// Ensure LLM content is a valid JSON string: when the model appends markup
// (e.g. a <tool_calls> block) after the JSON, keep only the leading JSON value.
// Valid JSON and plain text are returned unchanged.
export function cleanContent(content: string): string {
  if (!content) return content;

  try {
    JSON.parse(content.trim());
    return content;
  } catch {
    // not valid JSON as-is: try to isolate the leading JSON value
  }

  return extractLeadingJson(content) ?? content;
}

// Pull the first JSON value (object or string) out of content that mixes JSON
// with trailing markup (e.g. an LLM appending a <tool_calls> block). Returns
// null when no JSON value can be isolated. Only objects and strings are
// supported: the "output" schema always wraps the answer in an object.
function extractLeadingJson(content: string): string | null {
  // leading quoted string ("answer text") -> find its closing quote
  if (content.startsWith('"')) {
    let escaped = false;
    for (let i = 1; i < content.length; i++) {
      const ch = content[i]!;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        return content.slice(0, i + 1);
      }
    }
    return null;
  }

  // leading object ({...}) -> match braces, ignoring braces inside strings
  const start = content.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(start, i + 1);
      }
    }
  }
  return null;
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
