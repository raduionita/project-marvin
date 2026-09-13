import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import GoogleModel from './google.js';
import type { Chat } from '../types.js';

const origFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = origFetch;
}

function mockModel(): GoogleModel {
  const engine = new Engine();
  return new GoogleModel(engine, { model: 'gemini-2.0-flash', apiKey: 'test-key' });
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

function jsonResponse(body: any, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 400 });
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
    jsonResponse({ error: { message: 'bad key' } }, false)) as typeof fetch;

  await expect(model.sendChat(mockChat())).rejects.toThrow('[GoogleModel.sendChat] ERROR bad key');
  restoreFetch();
});
