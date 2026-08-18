import { test, expect } from 'bun:test';
import { extractOutput, cleanContent, extractLeadingJsonObject, withRetry, markdownToMrkdwn, mergeConfig } from './helpers.js';

test('extractOutput pulls the output field from JSON', () => {
  expect(extractOutput('{"output": "hello world"}')).toBe('hello world');
});

test('extractOutput returns plain text unchanged when not JSON', () => {
  expect(extractOutput('plain text reply')).toBe('plain text reply');
});

test('extractOutput decodes a JSON string value', () => {
  expect(extractOutput('"quoted value"')).toBe('quoted value');
});

test('extractOutput falls back to common answer keys', () => {
  expect(extractOutput('{"answer": "42"}')).toBe('42');
  expect(extractOutput('{"message": "hi"}')).toBe('hi');
});

test('extractOutput returns content unchanged when JSON has no string field', () => {
  expect(extractOutput('{"status": "ok"}')).toBe('{"status": "ok"}');
});

test('extractOutput handles empty content', () => {
  expect(extractOutput('')).toBe('');
  expect(extractOutput('{}')).toBe('{}');
});

test('cleanContent returns valid JSON unchanged', () => {
  expect(cleanContent('{"output": "hello world"}')).toBe('{"output": "hello world"}');
});

test('cleanContent keeps only the leading JSON object, dropping trailing markup', () => {
  const content = '{"output": "hello world"}<tool_calls>\n<invoke name="end_chat">\n<parameter name="answer">done</parameter>\n</invoke>\n</tool_calls>';
  expect(cleanContent(content)).toBe('{"output": "hello world"}');
});

test('cleanContent handles braces inside the JSON string value', () => {
  const content = '{"output": "use {this} and }that}"}<tool_calls>...</tool_calls>';
  expect(cleanContent(content)).toBe('{"output": "use {this} and }that}"}');
});

test('cleanContent returns plain text unchanged when no JSON value is present', () => {
  expect(cleanContent('plain text <tool_calls>...</tool_calls>')).toBe('plain text <tool_calls>...</tool_calls>');
});

test('extractLeadingJsonObject extracts the leading object, dropping trailing markup', () => {
  const content = '{"output": "hello world"}<tool_calls>\n<invoke name="end_chat">\n</invoke>\n</tool_calls>';
  expect(extractLeadingJsonObject(content)).toBe('{"output": "hello world"}');
});

test('extractLeadingJsonObject extracts the object from content prefixed with junk', () => {
  expect(extractLeadingJsonObject('Sure! Here it is: {"output": "hi"}')).toBe('{"output": "hi"}');
});

test('extractLeadingJsonObject extracts the object from content with multiple json blocks', () => {
  expect(extractLeadingJsonObject('Sure! Here it is: {"output": "first"} junk {"output": "second"} more junk')).toBe('{"output": "first"}');
});

test('extractLeadingJsonObject handles braces inside the JSON string value', () => {
  const content = '{"output": "use {this} and }that}"}<tool_calls>...</tool_calls>';
  expect(extractLeadingJsonObject(content)).toBe('{"output": "use {this} and }that}"}');
});

test('extractLeadingJsonObject handles nested objects', () => {
  const content = '{"a": {"b": {"c": 1}}} trailing';
  expect(extractLeadingJsonObject(content)).toBe('{"a": {"b": {"c": 1}}}');
});

test('extractLeadingJsonObject rejects a leading JSON string', () => {
  expect(extractLeadingJsonObject('"quoted value"')).toBeNull();
  expect(extractLeadingJsonObject('"quoted" trailing')).toBeNull();
});

test('extractLeadingJsonObject returns null when no object is present', () => {
  expect(extractLeadingJsonObject('plain text')).toBeNull();
  expect(extractLeadingJsonObject('')).toBeNull();
  expect(extractLeadingJsonObject('123')).toBeNull();
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
