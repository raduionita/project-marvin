import { test, expect } from 'bun:test';
import { withRetry, markdownToMrkdwn, mergeConfig, truncate } from './index.js';

test('truncate leaves short strings untouched', () => {
  expect(truncate('hello', 10)).toBe('hello');
  expect(truncate('hello', 5)).toBe('hello');
});

test('truncate clips long strings and appends a marker', () => {
  const out = truncate('x'.repeat(30), 10);
  expect(out.startsWith('x'.repeat(10))).toBe(true);
  expect(out).toContain('truncated 20 chars');
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
  const defaults = { settings: { name: 'marvin', port: 7331 }, channels: {}, integrations: {} };
  const incoming = { settings: { name: 'other' } };

  const merged = mergeConfig(defaults as any, incoming);

  expect(merged.settings.name).toBe('other');
  expect(merged.settings.port).toBe(7331);
  expect(merged.channels).toEqual({});
  expect(merged.integrations).toEqual({});
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
  const defaults = { settings: { name: 'marvin', port: 7331 }, integrations: {} };

  expect(mergeConfig(defaults as any, {})).toEqual(defaults);
});

test('mergeConfig does not merge arrays', () => {
  const defaults = { tasks: { a: { integrations: [] } } };
  const incoming = { tasks: { a: { integrations: ['wp'] } } };

  const merged = mergeConfig(defaults as any, incoming);

  expect(merged.tasks.a.integrations).toEqual(['wp']);
});
