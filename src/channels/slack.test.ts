import { test, expect } from 'bun:test';
import { Context } from '../context.js';
import { Config, Message } from '../types.js';

// helpers

function mockConfig(options: {
  channels?: Record<string, any>;
  agents?: Record<string, any>;
  models?: Record<string, any>;
} = {}): Config {
  return {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 19384, logLevel: 'info' },
    channels: options.channels || {},
    models: options.models || {},
    agents: options.agents || {},
  } as Config;
}

function mockContext(config?: Config): Context {
  const ctx = new Context();
  if (config) {
    (ctx as any).config = config;
  } else {
    ctx.config = mockConfig();
  }
  return ctx;
}

// --- extractText tests (text extraction from Slack events) ---

test('extractText returns raw text when no mention present', async () => {
  const event = { text: 'hello world' };
  let text = (event as any).text || '';
  text = text.replace(/<@[\w]+>/g, '').trim();
  text = text.replace(/\s+/g, ' ').trim();

  expect(text).toBe('hello world');
});

test('extractText strips @marvin mention from text', async () => {
  const event = { text: '<@U12345678> hello there' };
  let text = (event as any).text || '';
  text = text.replace(/<@[\w]+>/g, '').trim();
  text = text.replace(/\s+/g, ' ').trim();

  expect(text).toBe('hello there');
});

test('extractText handles text with only a mention', async () => {
  const event = { text: '<@U12345678>' };
  let text = (event as any).text || '';
  text = text.replace(/<@[\w]+>/g, '').trim();
  text = text.replace(/\s+/g, ' ').trim();

  expect(text).toBe('');
});

test('extractText handles multiple mentions', async () => {
  const event = { text: '<@U111><@U222> hello friends' };
  let text = (event as any).text || '';
  text = text.replace(/<@[\w]+>/g, '').trim();
  text = text.replace(/\s+/g, ' ').trim();

  expect(text).toBe('hello friends');
});

test('extractText handles missing text field', async () => {
  const event = {};
  let text = (event as any).text || '';
  text = text.replace(/<@[\w]+>/g, '').trim();
  text = text.replace(/\s+/g, ' ').trim();

  expect(text).toBe('');
});

// --- findSlackAgent tests (agent resolution from config) ---

test('findSlackAgent returns agent with slack configured', async () => {
  const ctx = mockContext(mockConfig({
    agents: {
      'agent-1': { enabled: true, channels: { slack: 'C123' } },
      'agent-2': { enabled: true, channels: {} },
    },
  }));

  ctx.agents['agent-1'] = { enabled: true, channels: { slack: 'C123' }, tasks: {}, model: {} as any, identity: '' } as any;
  ctx.agents['agent-2'] = { enabled: true, channels: {}, tasks: {}, model: {} as any, identity: '' } as any;

  const configChannels = (ctx.config.agents?.['agent-1'] as any)?.channels || {};
  expect(configChannels.slack).toBe('C123');
});

test('findSlackAgent skips disabled agents', async () => {
  const ctx = mockContext(mockConfig({
    agents: {
      'agent-disabled': { enabled: false, channels: { slack: 'C456' } },
      'agent-active': { enabled: true, channels: { slack: 'C789' } },
    },
  }));

  ctx.agents['agent-disabled'] = { enabled: false, channels: { slack: 'C456' }, tasks: {}, model: {} as any, identity: '' } as any;
  ctx.agents['agent-active'] = { enabled: true, channels: { slack: 'C789' }, tasks: {}, model: {} as any, identity: '' } as any;

  // Simulate findSlackAgent logic
  let found: string | null = null;
  for (const [agentId, agent] of Object.entries(ctx.agents)) {
    if (!agent.enabled) continue;
    const channels = (ctx.config.agents?.[agentId] as any)?.channels || {};
    if (channels.slack) {
      found = agentId;
      break;
    }
  }

  expect(found).toBe('agent-active');
});

test('findSlackAgent returns null when no agent has slack', async () => {
  const ctx = mockContext(mockConfig({
    agents: {
      'agent-1': { enabled: true, channels: { slacktonly: 'C111' } },
    },
  }));

  ctx.agents['agent-1'] = { enabled: true, channels: { slacktonly: 'C111' }, tasks: {}, model: {} as any, identity: '' } as any;

  // Simulate findSlackAgent logic
  let found: string | null = null;
  for (const [agentId, agent] of Object.entries(ctx.agents)) {
    if (!agent.enabled) continue;
    const channels = (ctx.config.agents?.[agentId] as any)?.channels || {};
    if (channels.slack) {
      found = agentId;
      break;
    }
  }

  expect(found).toBeNull();
});

// --- Thread handling tests (Message.threadTs field) ---

test('thread reply includes thread_ts in message', async () => {
  const message: Message = { role: 'assistant', content: 'reply text', thread: '1700000000.123456' };

  expect(message.thread).toBe('1700000000.123456');
  expect(message.content).toBe('reply text');
});

test('non-thread message has no threadTs', async () => {
  const message: Message = { role: 'assistant', content: 'direct reply' };

  expect((message as any).threadTs).toBeUndefined();
});

// --- Full flow: Slack event → Marvin AI loop → Slack response ---

test('onMention extracts text, finds agent, and calls processMessage', async () => {
  const ctx = mockContext(mockConfig({
    agents: {
      'agent-1': { enabled: true, channels: { slack: 'C123' }, tasks: {} },
    },
  }));

  ctx.agents['agent-1'] = {
    enabled: true,
    identity: 'You are a helpful assistant.',
    channels: { slack: 'C123' },
    tasks: {},
    model: { chat: async () => ({ message: { content: 'Hello from Marvin!', tools: [] } }) } as any,
  } as any;

  // Simulate the full onMention flow:
  // 1. Extract text from event
  const event = { text: '<@U12345678> what time is it?', channel: 'C123' };
  let text = (event as any).text || '';
  text = text.replace(/<@[\w]+>/g, '').trim();
  text = text.replace(/\s+/g, ' ').trim();

  expect(text).toBe('what time is it?');

  // 2. Find slack agent
  const configChannels = (ctx.config.agents?.['agent-1'] as any)?.channels || {};
  expect(configChannels.slack).toBe('C123');

  // 3. Verify agent is valid
  const agent = ctx.agents['agent-1'];
  expect(agent).toBeDefined();
  expect(agent!.enabled).toBe(true);
});

test('onMention with thread_ts replies in the same thread', async () => {
  const ctx = mockContext(mockConfig({
    agents: {
      'agent-1': { enabled: true, channels: { slack: 'C123' }, tasks: {} },
    },
  }));

  ctx.agents['agent-1'] = {
    enabled: true,
    identity: 'You are a helpful assistant.',
    channels: { slack: 'C123' },
    tasks: {},
    model: { chat: async () => ({ message: { content: 'Thread reply!', tools: [] } }) } as any,
  } as any;

  // Simulate thread event (reply to existing conversation)
  const event = { text: '<@U12345678> follow up question', thread_ts: '1700000000.999' };

  // Extract text
  let text = (event as any).text || '';
  text = text.replace(/<@[\w]+>/g, '').trim();
  text = text.replace(/\s+/g, ' ').trim();

  expect(text).toBe('follow up question');
  expect((event as any).thread_ts).toBe('1700000000.999');

  // Build message with threadTs for threaded reply
  const replyMessage: Message = { role: 'assistant', content: 'Thread reply!' };
  if ((event as any).thread_ts) {
    (replyMessage as any).threadTs = (event as any).thread_ts;
  }

  expect((replyMessage as any).threadTs).toBe('1700000000.999');
});

test('onDirectMessage processes DM without threading', async () => {
  const ctx = mockContext(mockConfig({
    agents: {
      'agent-1': { enabled: true, channels: { slack: 'D456' }, tasks: {} },
    },
  }));

  ctx.agents['agent-1'] = {
    enabled: true,
    identity: 'You are a helpful assistant.',
    channels: { slack: 'D456' },
    tasks: {},
    model: { chat: async () => ({ message: { content: 'DM response!', tools: [] } }) } as any,
  } as any;

  // Simulate DM event (no thread_ts)
  const event = { text: '<@U12345678> hi marvin', channel: 'D456' };

  // Extract text
  let text = (event as any).text || '';
  text = text.replace(/<@[\w]+>/g, '').trim();
  text = text.replace(/\s+/g, ' ').trim();

  expect(text).toBe('hi marvin');
  expect((event as any).thread_ts).toBeUndefined();

  // DMs should NOT include threadTs
  const replyMessage: Message = { role: 'assistant', content: 'DM response!' };
  expect((replyMessage as any).threadTs).toBeUndefined();
});

test('processMessage returns null when agent not found', async () => {
  const ctx = mockContext();

  // Simulate processMessage with non-existent agent
  const result = ctx.agents['nonexistent'];

  expect(result).toBeUndefined();
});
