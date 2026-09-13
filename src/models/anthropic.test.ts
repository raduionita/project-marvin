import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import AnthropicModel from './anthropic.js';
import type { Chat } from '../types.js';

const origFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = origFetch;
}

function mockModel(config: { [key: string]: any } = {}): AnthropicModel {
  const engine = new Engine();
  return new AnthropicModel(engine, { model: 'claude-sonnet-4-5', apiKey: 'test-key', ...config });
}

function mockChat(): Chat {
  return {
    id: 'test-chat',
    thinking: false,
    messages: [{ role: 'user', content: 'hi' }],
  };
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function okBody() {
  return {
    id: 'msg_1',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

test('sendChat maps text blocks to a Reply and stops the loop', async () => {
  const model = mockModel();
  globalThis.fetch = (async () => jsonResponse(okBody())) as typeof fetch;

  const reply = await model.sendChat(mockChat());

  expect(reply.stop).toBe(true);
  expect(reply.message.content).toBe('ok');
  expect(reply.usage).toEqual({ completion: 1, prompt: 1 });
  restoreFetch();
});

test('sendChat throws on non-OK response', async () => {
  const model = mockModel();
  globalThis.fetch = (async () =>
    jsonResponse({ error: { message: 'bad key' } }, 400)) as typeof fetch;

  await expect(model.sendChat(mockChat())).rejects.toThrow('[AnthropicModel.sendChat] ERROR bad key');
  restoreFetch();
});

// ==================== sendChat retry + timeout ====================

test('sendChat retries transient network failures and succeeds', async () => {
  const model = mockModel();
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
  const model = mockModel();
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
  const model = mockModel();
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
  const model = mockModel({ timeoutMs: 50 });
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
