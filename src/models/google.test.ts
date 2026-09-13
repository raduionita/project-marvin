import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import GoogleModel from './google.js';
import type { Chat } from '../types.js';

const origFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = origFetch;
}

function mockModel(config: { [key: string]: any } = {}): GoogleModel {
  const engine = new Engine();
  return new GoogleModel(engine, { model: 'gemini-2.0-flash', apiKey: 'test-key', ...config });
}

function mockChat(): Chat {
  return {
    id: 'test-chat',
    thinking: false,
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hi' },
    ],
  };
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test('sendChat maps text + functionCall parts to a Reply with tools', async () => {
  const model = mockModel();
  let seenUrl = '';
  let seenBody: any;
  globalThis.fetch = (async (url: any, init: any) => {
    seenUrl = String(url);
    seenBody = JSON.parse(init.body);
    return jsonResponse({
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [
          { text: 'hello' },
          { functionCall: { name: 'get_date', args: {} } },
        ] },
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 },
    });
  }) as typeof fetch;

  const reply = await model.sendChat(mockChat());

  expect(seenUrl).toContain('/v1beta/models/gemini-2.0-flash:generateContent');
  expect(seenBody.systemInstruction.parts[0].text).toBe('You are helpful.');
  expect(seenBody.contents[0].role).toBe('user');
  expect(reply.stop).toBe(false);
  expect(reply.finish).toBe('tool_calls');
  expect(reply.message.content).toBe('hello');
  expect(reply.message.tools!.length).toBe(1);
  expect(reply.message.tools![0]!.name).toBe('get_date');
  expect(reply.usage).toEqual({ completion: 7, prompt: 5 });
  restoreFetch();
});

test('sendChat text-only reply stops the loop', async () => {
  const model = mockModel();
  globalThis.fetch = (async () =>
    jsonResponse({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '  done  ' }] } }],
      usageMetadata: {},
    })) as typeof fetch;

  const reply = await model.sendChat(mockChat());

  expect(reply.stop).toBe(true);
  expect(reply.message.content).toBe('done');
  expect(reply.message.tools).toBeUndefined();
  restoreFetch();
});

test('sendChat with no candidates returns empty finish', async () => {
  const model = mockModel();
  globalThis.fetch = (async () => jsonResponse({})) as typeof fetch;

  const reply = await model.sendChat(mockChat());

  expect(reply.stop).toBe(true);
  expect(reply.finish).toBe('empty');
  expect(reply.message.content).toBe('');
  restoreFetch();
});

test('sendChat throws on non-OK response', async () => {
  const model = mockModel();
  globalThis.fetch = (async () =>
    jsonResponse({ error: { message: 'bad key' } }, 400)) as typeof fetch;

  await expect(model.sendChat(mockChat())).rejects.toThrow('[GoogleModel.sendChat] ERROR bad key');
  restoreFetch();
});

// ==================== sendChat retry + timeout ====================

function okBody() {
  return {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
  };
}

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

test('config baseUrl survives construction, default otherwise', () => {
  expect(mockModel({ baseUrl: 'http://proxy:8080' }).baseUrl).toBe('http://proxy:8080');
  expect(mockModel().baseUrl).toBe('https://generativelanguage.googleapis.com');
});
