import { test, expect } from 'bun:test';
import { withRetry, markdownToMrkdwn, mergeConfig, truncate, detectBaseUrl, detectProvider } from './index.js';
import { MODEL_BASE_URLS } from '../constants.js';

test('truncate leaves short strings untouched', () => {
  expect(truncate('hello', 10)).toBe('hello');
  expect(truncate('hello', 5)).toBe('hello');
});

test('truncate clips long strings and appends a marker', () => {
  const out = truncate('x'.repeat(30), 10);
  expect(out.startsWith('x'.repeat(10))).toBe(true);
  expect(out).toContain('xxxxxxxxxx...');
});

test('truncate returns the text for non-positive max only when short', () => {
  expect(truncate('abc', 0)).toBe('abc');
});

test('withRetry retries until success', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts++;
    if (attempts < 3) throw new Error('transient');
    return 'ok';
  }, { retries: 3, delayMs: 1 });

  expect(result).toBe('ok');
  expect(attempts).toBe(3);
});

test('withRetry gives up after retries are exhausted', async () => {
  let attempts = 0;
  await expect(async () => {
    await withRetry(async () => {
      attempts++;
      throw new Error('boom');
    }, { retries: 2, delayMs: 1 });
  }).toThrow('boom');

  expect(attempts).toBe(3);
});

test('withRetry does not retry when shouldRetry says no', async () => {
  let attempts = 0;
  await expect(async () => {
    await withRetry(async () => {
      attempts++;
      throw new Error('permanent');
    }, { retries: 3, delayMs: 1, shouldRetry: () => false });
  }).toThrow('permanent');

  expect(attempts).toBe(1);
});

test('markdownToMrkdwn converts headers to bold', () => {
  expect(markdownToMrkdwn('# Hello')).toBe('*Hello*');
  expect(markdownToMrkdwn('### Deep')).toBe('*Deep*');
});

test('markdownToMrkdwn converts bold, italic and strikethrough', () => {
  expect(markdownToMrkdwn('**bold** and *italic* and ~~gone~~')).toBe('*bold* and _italic_ and ~gone~');
});

test('markdownToMrkdwn converts links to mrkdwn format', () => {
  expect(markdownToMrkdwn('[docs](https://example.com)')).toBe('<https://example.com|docs>');
});

test('markdownToMrkdwn converts unordered lists to bullets', () => {
  expect(markdownToMrkdwn('- one\n- two')).toBe('• one\n• two');
});

test('markdownToMrkdwn leaves code blocks and inline code untouched', () => {
  const md = '```js\nconst x = **not bold**;\n```\nand `**code**` here';
  expect(markdownToMrkdwn(md)).toBe(md);
});

test('markdownToMrkdwn handles empty content', () => {
  expect(markdownToMrkdwn('')).toBe('');
});

test('mergeConfig fills missing keys with defaults', () => {
  const defaults = { settings: { name: 'marvin', port: 7331 }, channels: {} };
  const incoming = { settings: { name: 'other' } };

  const merged = mergeConfig(defaults as any, incoming);

  expect(merged.settings.name).toBe('other');
  expect(merged.settings.port).toBe(7331);
  expect(merged.channels).toEqual({});
});

test('mergeConfig keeps incoming top-level keys not in defaults', () => {
  const defaults = { settings: { name: 'marvin' }, channels: {} };
  const incoming = { tasks: { daily: { enabled: true } } };

  const merged = mergeConfig(defaults as any, incoming);

  expect(merged.tasks).toEqual({ daily: { enabled: true } });
});

test('mergeConfig merges nested objects recursively, incoming wins', () => {
  const defaults = { models: {}, agents: { marvin: { enabled: false, channels: {} } } };
  const incoming = { agents: { marvin: { enabled: true, channels: { slack: 'C123' } } } };

  const merged = mergeConfig(defaults as any, incoming);

  expect(merged.agents.marvin.enabled).toBe(true);
  expect(merged.agents.marvin.channels).toEqual({ slack: 'C123' });
});

test('mergeConfig treats empty incoming as full defaults', () => {
  const defaults = { settings: { name: 'marvin', port: 7331 }, channels: {} };

  expect(mergeConfig(defaults as any, {})).toEqual(defaults);
});

test('detectBaseUrl matches known vendors from the model name', () => {
  expect(detectBaseUrl('deepseek-chat', 'openai')).toBe(MODEL_BASE_URLS.deepseek);
  expect(detectBaseUrl('qwen3-35b', 'openai')).toBe(MODEL_BASE_URLS.qwen);
  expect(detectBaseUrl('kimi-k2', 'openai')).toBe(MODEL_BASE_URLS.moonshot);
  expect(detectBaseUrl('moonshot-v1-8k', 'openai')).toBe(MODEL_BASE_URLS.moonshot);
  expect(detectBaseUrl('openrouter/auto', 'openai')).toBe(MODEL_BASE_URLS.openrouter);
  expect(detectBaseUrl('meta-llama/llama-4-scout', 'openai')).toBe(MODEL_BASE_URLS.meta);
  expect(detectBaseUrl('gemini-2.0-flash', 'openai')).toBe(MODEL_BASE_URLS.google);
  expect(detectBaseUrl('claude-sonnet-4', 'openai')).toBe(MODEL_BASE_URLS.anthropic);
  expect(detectBaseUrl('gpt-4o-mini', 'openai')).toBe(MODEL_BASE_URLS.openai);
});

test('detectBaseUrl is case-insensitive and falls back to the provider default', () => {
  expect(detectBaseUrl('DeepSeek-Reasoner', 'openai')).toBe(MODEL_BASE_URLS.deepseek);
  expect(detectBaseUrl('something-custom', 'openai')).toBe(MODEL_BASE_URLS.openai);
  expect(detectBaseUrl('something-custom', 'anthropic')).toBe(MODEL_BASE_URLS.anthropic);
  expect(detectBaseUrl('something-custom', 'google')).toBe(MODEL_BASE_URLS.google);
  expect(detectBaseUrl('', 'openai')).toBe(MODEL_BASE_URLS.openai);
});

test('detectBaseUrl maps local model names to localhost', () => {
  expect(detectBaseUrl('localhost/qwen3', 'openai')).toBe(MODEL_BASE_URLS.local);
});

test('detectProvider guesses the provider from the model name', () => {
  expect(detectProvider('gemini-2.0-flash')).toBe('google');
  expect(detectProvider('claude-sonnet-4')).toBe('anthropic');
  expect(detectProvider('gpt-4o-mini')).toBe('openai');
  expect(detectProvider('deepseek-chat')).toBe('openai');
  expect(detectProvider('kimi-k2')).toBe('openai');
  expect(detectProvider('')).toBe('openai');
});

test('mergeConfig does not merge arrays', () => {
  const defaults = { tasks: { a: { tags: [] } } };
  const incoming = { tasks: { a: { tags: ['wp'] } } };

  const merged = mergeConfig(defaults as any, incoming);

  expect(merged.tasks.a.tags).toEqual(['wp']);
});
