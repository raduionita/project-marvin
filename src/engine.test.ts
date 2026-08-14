import { test, expect } from 'bun:test';
import Engine from './engine.js';
import { Logger } from './logger.js';
import { Chat, Config, Agent, Integration } from './types.js';
import * as constants from './constants.js';

function buildEngine(): Engine {
  const engine = new Engine(new Logger());
  engine.state = 'load';
  engine.config = {
    settings: { name: 'marvin', host: '127.0.0.1', port: 7331, logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: {},
    models: {},
    agents: {},
  } as Config;
  return engine;
}

function chatWith(messages: Chat['messages']): Chat {
  return { id: 'c', thinking: false, messages, updatedAt: Date.now() };
}

test('trimChat keeps only the system message + the last N messages', () => {
  const engine = buildEngine();
  const chat = chatWith([
    { role: 'system', content: 'sys' },
    ...Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, content: `msg-${i}` })),
  ]);

  engine.trimChat(chat);

  expect(chat.messages.length).toBe(constants.MAX_CHAT_MESSAGES);
  expect(chat.messages[0]).toEqual({ role: 'system', content: 'sys' });
  expect(chat.messages[chat.messages.length - 1]).toEqual({ role: 'user', content: 'msg-29' });
});

test('trimChat leaves short histories untouched', () => {
  const engine = buildEngine();
  const chat = chatWith([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ]);

  engine.trimChat(chat);

  expect(chat.messages.length).toBe(2);
});

test('trimChat drops oldest messages when there is no system message', () => {
  const engine = buildEngine();
  const chat = chatWith(Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, content: `msg-${i}` })));

  engine.trimChat(chat);

  expect(chat.messages.length).toBe(constants.MAX_CHAT_MESSAGES);
  expect(chat.messages[0]).toEqual({ role: 'user', content: 'msg-6' });
});

test('execSweep removes chats idle longer than the TTL and reschedules', async () => {
  const engine = buildEngine();
  engine.state = 'exec';
  engine.agents['marvin'] = {
    id: 'marvin',
    enabled: true,
    identity: '',
    channels: {},
    model: {} as never,
    tasks: {
      sweep: { id: 'sweep', enabled: true, type: 'sweep', schedule: 1000, maxSteps: 0, timeout: null },
    },
  } as Agent;

  const stale = chatWith([{ role: 'user', content: 'old' }]);
  engine.saveChat('stale', stale);
  stale.updatedAt = Date.now() - constants.CHAT_TTL_MS - 1000;

  const fresh = chatWith([{ role: 'user', content: 'new' }]);
  engine.saveChat('fresh', fresh);

  await engine.execSweep('marvin', 'sweep');

  expect(engine.findChat('stale')).toBeNull();
  expect(engine.findChat('fresh')).not.toBeNull();

  // rescheduled for the next run
  const task = engine.agents['marvin']!.tasks['sweep']!;
  expect(task.timeout).not.toBeNull();
  clearTimeout(task.timeout!);
});

test('saveChat/findChat track last use time', () => {
  const engine = buildEngine();
  const chat = chatWith([{ role: 'user', content: 'hi' }]);
  engine.saveChat('x', chat);

  // simulate an idle chat, then confirm findChat bumps last-use time
  chat.updatedAt = 0;
  engine.findChat('x');
  expect(chat.updatedAt).toBeGreaterThan(0);
});

test('drop clears the chat cache', async () => {
  const engine = buildEngine();
  engine.saveChat('x', chatWith([{ role: 'user', content: 'hi' }]));

  await engine.drop();

  expect(engine.findChat('x')).toBeNull();
});

test('sendChat returns an error field when the agent does not exist', async () => {
  const engine = buildEngine();
  engine.state = 'exec';

  const result = await engine.sendChat('chat-1', 'nope', 'hello');

  expect(result.content).toBe('');
  expect(result.error).toBeDefined();
});

test('makeSystemPrompt renders an integrations block for loaded integrations', () => {
  const engine = buildEngine();
  engine.integrations['gloobeam'] = new class extends Integration {
    args = { endpoint: 'https://gloobeam.com' };
    meta = {
      type: 'wordpress',
      title: 'Wordpress',
      description: 'Post articles to a Wordpress site via its REST API',
      actions: [
        { name: 'create_post', description: 'Create a new post' },
        { name: 'publish_post', description: 'Publish an existing draft post' },
      ],
    };
    async load() {}
    async drop() {}
    async call() { return {}; }
  }(engine, new Logger(), { type: 'wordpress', endpoint: 'https://gloobeam.com' });

  const prompt = engine.makeSystemPrompt('', 'text', {});

  expect(prompt).toContain('## Integrations');
  expect(prompt).toContain('### gloobeam (https://gloobeam.com)');
  expect(prompt).toContain('create_post - Create a new post');
  expect(prompt).toContain('publish_post - Publish an existing draft post');
});

test('makeSystemPrompt falls back to config when integrations are not loaded', () => {
  const engine = buildEngine();
  engine.config.integrations = { gloobeam: { enabled: true, type: 'wordpress', endpoint: 'https://gloobeam.com' } };

  const prompt = engine.makeSystemPrompt('', 'text', {});

  expect(prompt).toContain('## Integrations');
  expect(prompt).toContain('### gloobeam (https://gloobeam.com)');
});

test('makeSystemPrompt returns only the identity when there are no integrations', () => {
  const engine = buildEngine();

  expect(engine.makeSystemPrompt('my identity', 'text', {})).toBe('my identity');
});
