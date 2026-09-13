import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import OpenaiModel, { Choice } from './openai.js';
import type { Chat } from '../types.js';

class OpenaiMock extends OpenaiModel {}

function mockdModel(config: { [key: string]: any } = {}): OpenaiModel {
  const engine = new Engine();
  return new OpenaiMock(engine, config);
}

function mockChoice(content: string, toolCalls?: Choice['message']['tool_calls']): Choice {
  return {
    finish_reason: 'stop',
    index: 0,
    message: { role: 'assistant', content, tool_calls: toolCalls },
  };
}

// ==================== DSML tool_calls ====================

test('prepChoice extracts DSML tool_calls and strips the tags from content', () => {
  const model = mockdModel();
  const content = [
    'Here is the file:',
    '<tool_calls>',
    '<invoke name="read">',
    '<parameter name="filePath" string="true">/tmp/x</parameter>',
    '</invoke>',
    '<invoke name="read">',
    '<parameter name="filePath" string="true">/tmp/y</parameter>',
    '<parameter name="offset" string="false">10</parameter>',
    '</invoke>',
    '</tool_calls>',
  ].join('\n');

  const result = model.prepChoice(mockChoice(content));

  expect(result.message.content).toBe('Here is the file:');
  expect(result.message.tool_calls!.length).toBe(2);
  expect(result.message.tool_calls![0]!.function.name).toBe('read');
  expect(result.message.tool_calls![0]!.function.arguments).toBe('{"filePath":"/tmp/x"}');
  expect(result.message.tool_calls![1]!.function.arguments).toBe('{"filePath":"/tmp/y","offset":"10"}');
});

test('prepChoice does not duplicate DSML tool_calls that already exist', () => {
  const model = mockdModel();
  const existing = [{
    id: 'call_abc',
    type: 'function',
    function: { name: 'read', arguments: '{"filePath":"/tmp/x"}' },
  }];
  const content = '<tool_calls><invoke name="read"><parameter name="filePath" string="true">/tmp/x</parameter></invoke></tool_calls>';

  const result = model.prepChoice(mockChoice(content, existing));

  expect(result.message.tool_calls!.length).toBe(1);
  expect(result.message.tool_calls![0]!.id).toBe('call_abc');
});

// ==================== text format ====================

test('prepChoice trims content', () => {
  const model = mockdModel();

  const result = model.prepChoice(mockChoice('  hello world  '));

  expect(result.message.content).toBe('hello world');
});

// ==================== sendChat retry + timeout ====================

const origFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = origFetch;
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockChat(): Chat {
  return { id: 'test-chat', thinking: false, messages: [{ role: 'user', content: 'hi' }] };
}

function okBody() {
  return { id: 'chat-1', choices: [mockChoice('ok')], usage: { prompt_tokens: 1, completion_tokens: 1 } };
}

test('sendChat retries transient network failures and succeeds', async () => {
  const model = mockdModel();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls < 3) throw new TypeError('fetch failed');
    return jsonResponse(okBody());
  }) as typeof fetch;

  const reply = await model.sendChat(mockChat());

  expect(calls).toBe(3);
  expect(reply.message.content).toBe('ok');
  restoreFetch();
});

test('sendChat does not retry client errors (400)', async () => {
  const model = mockdModel();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return jsonResponse({ error: { message: 'bad request' } }, 400);
  }) as typeof fetch;

  await expect(model.sendChat(mockChat())).rejects.toThrow('bad request');
  expect(calls).toBe(1);
  restoreFetch();
});

test('sendChat retries 5xx and succeeds', async () => {
  const model = mockdModel();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls < 2) return jsonResponse({ error: { message: 'server error' } }, 500);
    return jsonResponse(okBody());
  }) as typeof fetch;

  const reply = await model.sendChat(mockChat());

  expect(calls).toBe(2);
  expect(reply.message.content).toBe('ok');
  restoreFetch();
});

test('sendChat times out a hung request and retries', async () => {
  const model = mockdModel({ timeoutMs: 50 });
  let calls = 0;
  globalThis.fetch = (async (_url: any, init: any) => {
    calls = calls + 1;
    // hang until the abort signal fires, then reject like a real timeout
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }) as typeof fetch;

  await expect(model.sendChat(mockChat())).rejects.toThrow();
  expect(calls).toBe(3); // initial + 2 retries
  restoreFetch();
});
