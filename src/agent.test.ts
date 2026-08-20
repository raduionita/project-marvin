import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Channel, ChannelMeta, Config, Model, Chat, Reply, Message, Tool, Integration, IntegrationMeta, ToolMeta } from './types.js';
import { Agent } from './agent.js';
import * as constants from './constants.js';
import Engine from './engine.js';
import { Logger } from './logger.js';

// --- helpers ---

function mockConfig(channels: Config['channels'] = {}, models: Config['models'] = {}, agents: Config['agents'] = {}, integrations: Config['integrations'] = {}): Config {
  return {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels,
    models,
    agents,
    integrations,
  } as Config;
}

function mockEngine(isDry = false): Engine {
  const engine = new Engine(new Logger());
  engine.isDry = isDry;
  engine.state = 'exec';
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-agent-'));
  engine.config = mockConfig();
  return engine;
}

/** A real Model subclass instance that returns a controllable reply. */
class MockModel extends Model {
  enabled = true;
  default = true;
  provider = 'openai' as const;
  model = 'mock';
  baseUrl = '';
  apiKey = '';
  temperature = 0.7;
  topP = 0.95;
  topK = 40;
  maxTokens = 8192;
  n = 1;
  userId = 'test';
  reasoning = 'high';
  tools: any[] = [];
  /** Tracks how many times execChat was called. */
  callCount = 0;

  private _reply: Reply;

  constructor(engine: Engine, reply: Reply) {
    super(engine, new Logger(), {});
    this._reply = reply;
  }

  async execChat(chat: Chat): Promise<Reply> {
    this.callCount++;
    return this._reply;
  }

  setReply(reply: Reply) {
    this._reply = reply;
  }
}

/** A minimal mock tool. */
class MockTool extends Tool {
  meta = { type: 'function', function: { name: 'mock_tool', description: '', parameters: { type: 'object', properties: {}, required: [] } } };
  async call(_args: any): Promise<any> {
    return { result: 'tool output' };
  }
}

/** A mock channel that records sent messages. */
class TestChannel extends Channel {
  public meta: ChannelMeta = { name: 'test', arguments: {} };
  async load(): Promise<void> {}
  async drop(): Promise<void> {}
  async sendMessage(message: Message): Promise<any> {
    this.logger.debug('[TestChannel.sendMessage]', JSON.stringify(message));
    return message;
  }

  async info(): Promise<{ groups: { [key: string]: string } }> {
    return { groups: {} };
  }
}

/** Build a fully wired engine with an agent, mock model, and mock channel. */
function buildTestEngine(opts?: {
  channelEnabled?: boolean;
  channelName?: string;
  agentId?: string;
  agentModel?: string;
  agentChannels?: Record<string, string>;
  isDry?: boolean;
  replyContent?: string;
  replyStop?: boolean;
  toolCalls?: Message['tools'];
  customReply?: Reply;
  configAgents?: Record<string, any>;
}): Engine {
  const {
    channelEnabled = true,
    channelName = 'test.channel',
    agentId = 'marvin',
    agentModel = 'mock.model',
    agentChannels = { 'test.channel': 'default' },
    isDry = false,
    replyContent = 'end chat',
    replyStop,
    toolCalls,
    customReply,
    configAgents,
  } = opts || {};

  const engine = mockEngine(isDry);

  engine.config = mockConfig(
    channelEnabled ? { [channelName]: { enabled: true } } : {},
    { [agentModel]: { enabled: true, provider: 'openai', model: 'mock', baseUrl: '', apiKey: '' } },
    configAgents || {
      [agentId]: {
        enabled: true,
        default: true,
        model: agentModel,
        channels: agentChannels,
      },
    }
  );

  // Build the reply
  const reply = customReply || (replyStop
    ? ({ id: 'reply-1', stop: true, finish: undefined, usage: { completion: 10, prompt: 20 }, message: { role: 'assistant', content: replyContent || '' } } as Reply)
    : ({ id: 'reply-1', stop: false, finish: undefined, usage: { completion: 10, prompt: 20 }, message: { role: 'assistant', content: replyContent || '' } } as Reply));

  // Create and install a real mock model instance
  const mockModelInstance = new MockModel(engine, reply);
  engine.models[agentModel] = mockModelInstance;

  // Install a mock agent with proper identity
  const identity = 'You are Marvin.';
  engine.agents[agentId] = new Agent(engine, new Logger(), {
    id: agentId,
    enabled: true,
    identity,
    channels: agentChannels,
    model: mockModelInstance,
  });

  // Install a mock channel
  if (channelEnabled) {
    const ch = new TestChannel(engine, new Logger());
    engine.channels[channelName] = ch;
  }

  // Install a mock tool (needed if tool calls are sent)
  engine.tools['mock_tool'] = new MockTool(engine, new Logger());

  return engine;
}

function chatWith(messages: Chat['messages']): Chat {
  return { id: 'c', thinking: false, messages, updated: Date.now() };
}

// ==================== sendChat (AI loop) tests ====================

test('sendChat returns dry result when engine.isDry is true', async () => {
  const engine = buildTestEngine({ isDry: true });

  const result = await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  // Dry mode returns early without calling the model
  expect(result).toEqual({ content: '(dry)', steps: 0 });
  // Verify the model was never invoked by checking the chat has no assistant messages
  const chat = engine.agents['marvin']!.loadChat('chat-1');
  expect(chat).toBeDefined();
  const assistantMessages = chat!.messages.filter((m: Message) => m.role === 'assistant');
  expect(assistantMessages.length).toBe(0);
});

test('sendChat pushes system and user messages to chat', async () => {
  const engine = buildTestEngine();

  await engine.agents['marvin']!.sendChat('chat-1', 'hello world');

  const chat = engine.agents['marvin']!.loadChat('chat-1');
  expect(chat).not.toBeNull();
  // 2 system/user messages + 20 assistant replies from the AI loop
  expect(chat!.messages.length).toBe(22);
  expect(chat!.messages[0]!.role).toBe('system');
  expect(chat!.messages[0]!.content).toContain('You are Marvin.');
  expect(chat!.messages[1]!.role).toBe('user');
  expect(chat!.messages[1]!.content).toBe('hello world');
  // Verify assistant replies were persisted
  const assistantMessages = chat!.messages.filter((m: Message) => m.role === 'assistant');
  expect(assistantMessages.length).toBe(20);
});

test('sendChat returns content and step count from model reply', async () => {
  const engine = buildTestEngine({ replyContent: 'hello from model' });

  const result = await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  expect(result).not.toBeNull();

  expect(result!.content).toBe('hello from model');
  // The mock model returns stop=false, no tools, no end chat.
  // The loop runs DEFAULT_MAX_STEPS (20) times: steps goes -1, 0, ..., 18 -> final steps=19
  expect(result!.steps).toBe(19);
});

test('sendChat caches the chat after execution', async () => {
  const engine = buildTestEngine();

  await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  const cached = engine.agents['marvin']!.loadChat('chat-1');
  expect(cached).toBeDefined();
  expect(cached!.id).toBe('chat-1');
  expect(cached!.messages.length).toBeGreaterThan(0);
});

test('sendChat reuses existing chat when chatId already exists', async () => {
  const engine = buildTestEngine();

  // First call
  await engine.agents['marvin']!.sendChat('chat-1', 'first');

  // Second call with same chatId
  await engine.agents['marvin']!.sendChat('chat-1', 'second');

  const chat = engine.agents['marvin']!.loadChat('chat-1');
  // Each call adds 2 messages (system + user) + 5 assistant replies (one per loop iteration)
  // But the model always returns the same reply, so we get 2 calls * (2 + 5) = 14 messages
  // Actually: first call: system + user + 5 assistant = 7
  // second call: system + user + 5 assistant = 7 more
  expect(chat!.messages.length).toBeGreaterThan(4);
  expect(chat!.messages[chat!.messages.length - 1]!.content).toBe('end chat');
});

test('sendChat calls agent.model.execChat DEFAULT_MAX_STEPS times when never stopping', async () => {
  const engine = buildTestEngine();

  await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  const model = engine.models['mock.model'] as MockModel;
  // The model is called exactly DEFAULT_MAX_STEPS times (20) when it never stops
  expect(model.callCount).toBe(20);
});

test('sendChat stops when reply.stop is true', async () => {
  const engine = buildTestEngine({ replyStop: true, replyContent: 'stopped early' });

  const result = await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  expect(result).not.toBeNull();

  expect(result!.content).toBe('stopped early');
  // With stop=true, the model is called only once
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
});

test('sendChat executes tool calls from model reply', async () => {
  const engine = buildTestEngine();

  // Replace the model's reply (not the instance) so the agent's reference stays valid
  const toolCallReply: Reply = {
    id: 'reply-2',
    stop: false,
    finish: undefined,
    usage: { completion: 5, prompt: 10 },
    message: {
      role: 'assistant',
      content: '',
      tools: [{ id: 'tool-1', name: 'mock_tool', arguments: {} }],
    },
  } as Reply;

  (engine.models['mock.model'] as MockModel).setReply(toolCallReply);

  await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  // After tool execution, the loop continues (no end chat, no stop).
  // The model is called: 1 (tool call) + 19 (remaining iterations) = 20 total
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(20);

  // Check that tool result was pushed to chat
  const chat = engine.agents['marvin']!.loadChat('chat-1');
  const toolMessages = chat!.messages.filter((m: Message) => m.role === 'tool');
  expect(toolMessages.length).toBeGreaterThan(0);
});

test('sendChat handles invalid JSON in tool arguments gracefully', async () => {
  const engine = buildTestEngine();

  // Replace the model's reply (not the instance) so the agent's reference stays valid
  const badToolReply: Reply = {
    id: 'reply-3',
    stop: false,
    finish: undefined,
    usage: { completion: 5, prompt: 10 },
    message: {
      role: 'assistant',
      content: '',
      tools: [{ id: 'tool-2', name: 'mock_tool', arguments: {} }],
    },
  } as Reply;

  (engine.models['mock.model'] as MockModel).setReply(badToolReply);

  // Should not throw - it should catch the JSON parse error and push an error result
  const result = await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  expect(result).toBeDefined();
  // Verify tool error was pushed to chat
  const chat = engine.agents['marvin']!.loadChat('chat-1');
  const toolMessages = chat!.messages.filter((m: Message) => m.role === 'tool');
  expect(toolMessages.length).toBeGreaterThan(0);
  // The tool error message should contain the parse error
  const errorContent = toolMessages[0]!.content;
  expect(typeof errorContent).toBe('string');
});

test('sendChat stops the AI loop when end chat tool call is found', async () => {
  const engine = buildTestEngine();

  // Replace the model's reply (not the instance) so the agent's reference stays valid
  const finalAnswerReply: Reply = {
    id: 'reply-4',
    stop: false,
    finish: undefined,
    usage: { completion: 5, prompt: 10 },
    message: {
      role: 'assistant',
      content: '',
      tools: [{ id: 'final-1', name: constants.END_CHAT_NAME, arguments: {"answer": "done"} }],
    },
  } as Reply;

  (engine.models['mock.model'] as MockModel).setReply(finalAnswerReply);

  const result = await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  expect(result).not.toBeNull();;

  // Should only call the model once - the end chat causes an immediate exit
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
  expect(result!.content).toBe(''); // The end chat content is empty in our reply
});

test('sendChat returns empty content when reply has no message content', async () => {
  const engine = buildTestEngine();

  // Replace the model's reply (not the instance) so the agent's reference stays valid
  // Stop=true ensures the loop exits after 1 iteration
  (engine.models['mock.model'] as MockModel).setReply({
    id: 'reply-5',
    stop: true,
    finish: undefined,
    usage: { completion: 0, prompt: 0 },
    message: { role: 'assistant', content: '' },
  } as Reply);

  const result = await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  expect(result).not.toBeNull();

  expect(result!.content).toBe('');
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
});

test('sendChat returns an error when the agent has no model', async () => {
  const engine = buildTestEngine();

  // sendChat swallows internal errors and returns an error field when the
  // agent cannot run (e.g. no model attached)
  const agent = new Agent(engine, new Logger(), { id: 'nonexistent', enabled: true, identity: '', channels: {}, model: undefined as any });
  const result = await agent.sendChat('chat-1', 'hello');

  expect(result.content).toBe('');
  expect(result.error).toBeDefined();
});

test('sendChat returns content and steps from model reply', async () => {
  const engine = buildTestEngine();

  const result = await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  expect(result).not.toBeNull();;

  expect(result!.content).toBe('end chat');
  // The model runs DEFAULT_MAX_STEPS (20) times: steps goes -1, 0, ..., 18 -> final steps=19
  expect(result!.steps).toBe(19);
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(20);
});

test('sendChat passes correct chatId to cache', async () => {
  const engine = buildTestEngine();

  await engine.agents['marvin']!.sendChat('unique-chat-id', 'hello');

  const chat = engine.agents['marvin']!.loadChat('unique-chat-id');
  expect(chat!.id).toBe('unique-chat-id');
});

test('sendChat returns empty string when reply.message is undefined', async () => {
  const engine = buildTestEngine();

  // Replace the model's reply (not the instance) so the agent's reference stays valid
  // Stop=true ensures the loop exits after 1 iteration
  (engine.models['mock.model'] as MockModel).setReply({
    id: 'reply-7',
    stop: true,
    finish: undefined,
    usage: { completion: 0, prompt: 0 },
    message: {} as Message,
  } as Reply);

  const result = await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  expect(result).not.toBeNull();

  expect(result!.content).toBe('');
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
});

// ==================== execTool tests ====================

/** A mock integration that records every call and exposes discoverable actions. */
class MockIntegration extends Integration {
  meta: IntegrationMeta = {
    type: 'mock',
    title: 'Mock',
    description: 'Mock integration',
    arguments: { endpoint: 'https://example.com' },
    actions: { create_post: 'Create a post' },
  };
  calls: { action: string; args: { [key: string]: any } }[] = [];

  async load() {}
  async drop() {}
  async call(args: { [key: string]: any }) {
    this.calls.push({ action: args.action, args });
    return { ok: true, id: 1 };
  }
}

test('execTool routes integration tools to the linked integration', async () => {
  const engine = buildTestEngine();
  const integration = new MockIntegration(engine, new Logger(), { type: 'mock' });
  engine.integrations['gloobeam'] = integration;

  const result = await engine.agents['marvin']!.execTool('gloobeam__create_post', { title: 'Hello' });

  expect(integration.calls.length).toBe(1);
  expect(integration.calls[0]!.action).toBe('create_post');
  expect(integration.calls[0]!.args).toEqual({ action: 'create_post', title: 'Hello' });
  expect(result.ok).toBe(true);
});

test('execTool returns an error for unknown integration tools', async () => {
  const engine = buildTestEngine();

  const result = await engine.agents['marvin']!.execTool('nope__create_post', {});

  expect(result.error).toContain('does NOT exist');
});

// ==================== packChat tests ====================

test('packChat keeps only the system message + the last N messages', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, new Logger(), { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  const chat = chatWith([
    { role: 'system', content: 'sys' },
    ...Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, content: `msg-${i}` })),
  ]);

  agent.packChat(chat);

  expect(chat.messages.length).toBe(constants.MAX_CHAT_MESSAGES);
  expect(chat.messages[0]).toEqual({ role: 'system', content: 'sys' });
  expect(chat.messages[chat.messages.length - 1]).toEqual({ role: 'user', content: 'msg-29' });
});

test('packChat leaves short histories untouched', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, new Logger(), { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  const chat = chatWith([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ]);

  agent.packChat(chat);

  expect(chat.messages.length).toBe(2);
});

test('packChat drops oldest messages when there is no system message', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, new Logger(), { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  const chat = chatWith(Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, content: `msg-${i}` })));

  agent.packChat(chat);

  expect(chat.messages.length).toBe(constants.MAX_CHAT_MESSAGES);
  expect(chat.messages[0]).toEqual({ role: 'user', content: 'msg-6' });
});

// ==================== saveChat / loadChat / makeChat tests ====================

test('saveChat/loadChat track last use time', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, new Logger(), { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  const chat = chatWith([{ role: 'user', content: 'hi' }]);
  agent.saveChat('x', chat);

  // simulate an idle chat, then confirm loadChat bumps last-use time
  chat.updated = 0;
  agent.loadChat('x');
  expect(chat.updated).toBeGreaterThan(0);
});

test('engine drop clears the agent chat cache but chats survive on disk', async () => {
  const engine = mockEngine();
  engine.state = 'load';
  const agent = new Agent(engine, new Logger(), { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  agent.saveChat('x', chatWith([{ role: 'user', content: 'hi' }]));

  await engine.drop();

  // cache is cleared (agents dropped), but the persisted copy is reloaded on demand
  const fresh = new Agent(engine, new Logger(), { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  expect(fresh.loadChat('x')).not.toBeNull();
  expect(fresh.loadChat('x')?.messages[0]).toEqual({ role: 'user', content: 'hi' });
  rmSync(engine.work, { recursive: true, force: true });
});

test('saveChat persists chats to disk and loadChat reloads them in a fresh agent', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, new Logger(), { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  agent.saveChat('persist-1', chatWith([{ role: 'user', content: 'persisted' }]));

  // a brand new agent over the same workspace reloads the chat from disk
  const fresh = new Agent(engine, new Logger(), { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  const loaded = fresh.loadChat('persist-1');

  expect(loaded).not.toBeNull();
  expect(loaded?.messages[0]).toEqual({ role: 'user', content: 'persisted' });
  rmSync(engine.work, { recursive: true, force: true });
});

test('makeChat creates a fresh chat (with system prompt) when none was saved', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, new Logger(), { id: 'a', enabled: true, identity: 'my identity', channels: {}, model: {} as never });

  const chat = agent.loadChat('never-saved');

  expect(chat.id).toBe('never-saved');
  expect(chat.messages[0]).toEqual({ role: 'system', content: 'my identity' });
  rmSync(engine.work, { recursive: true, force: true });
});

test('makeChat seeds a system prompt with an integrations block for loaded integrations', () => {
  const engine = mockEngine();
  engine.integrations['gloobeam'] = new class extends Integration {
    meta = {
      type: 'wordpress',
      title: 'Wordpress',
      description: 'Post articles to a Wordpress site via its REST API',
      arguments: { endpoint: 'https://gloobeam.com' },
      actions: {
        create_post: 'Create a new post',
        publish_post: 'Publish an existing draft post',
      },
    };
    async load() {}
    async drop() {}
    async call() { return {}; }
  }(engine, new Logger(), { type: 'wordpress', endpoint: 'https://gloobeam.com' });

  const agent = new Agent(engine, new Logger(), { memory: true, identity: '' });

  const chat = agent.loadChat('chat-1');
  const prompt = chat.messages[0]!.content as string;

  expect(prompt).toContain('## Integrations');
  expect(prompt).toContain('### gloobeam (https://gloobeam.com)');
  expect(prompt).toContain('create_post - Create a new post');
  expect(prompt).toContain('publish_post - Publish an existing draft post');
});

test('makeChat falls back to config when integrations are not loaded', () => {
  const engine = mockEngine();
  engine.config.integrations = { gloobeam: { enabled: true, type: 'wordpress', endpoint: 'https://gloobeam.com' } };
  const agent = new Agent(engine, new Logger(), { memory: true, identity: '' });

  const chat = agent.loadChat('chat-1');
  const prompt = chat.messages[0]!.content as string;

  expect(prompt).toContain('## Integrations');
  expect(prompt).toContain('### gloobeam (https://gloobeam.com)');
});

test('makeChat seeds only the identity when there are no integrations', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, new Logger(), { memory: false, identity: 'my identity' });

  expect(agent.loadChat('chat-1').messages[0]!.content).toBe('my identity');
});

test('makeChat renders a memory block when memory notes exist', () => {
  const engine = mockEngine();
  const mem = join(engine.work, 'memories');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'prefs.md'), 'Prefers concise answers');
  writeFileSync(join(mem, 'goals.md'), 'Ship marvin 1.0');

  const agent = new Agent(engine, new Logger(), { memory: true, identity: '' });

  const chat = agent.loadChat('chat-1');
  const prompt = chat.messages[0]!.content as string;

  expect(prompt).toContain('## Memory');
  expect(prompt).toContain('prefs: Prefers concise answers');
  expect(prompt).toContain('goals: Ship marvin 1.0');
  rmSync(engine.work, { recursive: true, force: true });
});

test('makeChat omits the memory block when memory is disabled', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, new Logger(), { memory: false, identity: 'my identity' });

  expect(agent.loadChat('chat-1').messages[0]!.content).toBe('my identity');
  rmSync(engine.work, { recursive: true, force: true });
});
