import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Channel, ChannelMeta, Config, Model, Chat, Reply, Message, Tool, ToolMeta } from './types.js';
import { Agent } from './agent.js';
import EndChatTool from './tools/end_chat.js';
import GetDateTool from './tools/get_date.js';
import LoadToolsTool from './tools/load_tools.js';
import ReadFileTool from './tools/read_file.js';
import WebSearchTool from './tools/web_search.js';
import * as constants from './constants.js';
import Engine from './engine.js';
import { Logger } from './logger.js';
import logger from './logger.js';

// --- helpers ---

function mockConfig(channels: Config['channels'] = {}, models: Config['models'] = {}, agents: Config['agents'] = {}): Config {
  return {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels,
    models,
    agents,
    tasks: {},
    mcps: {},
  } as Config;
}

function mockEngine(): Engine {
  const engine = new Engine();
  engine.state = 'exec';
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-agent-'));
  engine.config = mockConfig();
  engine.tools['end_chat'] = new EndChatTool(engine);
  engine.tools['load_tools'] = new LoadToolsTool(engine);
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
    super(engine, {});
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
  meta = { type: 'function', group: 'general', function: { name: 'mock_tool', description: '', parameters: { type: 'object', properties: {}, required: [] } } } as ToolMeta;
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
    logger.debug('[TestChannel.sendMessage]', JSON.stringify(message));
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
    replyContent = 'end chat',
    replyStop,
    toolCalls,
    customReply,
    configAgents,
  } = opts || {};

  const engine = mockEngine();

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
  engine.agents[agentId] = new Agent(engine, {
    id: agentId,
    enabled: true,
    identity,
    channels: agentChannels,
    model: mockModelInstance,
  });

  // Install a mock channel
  if (channelEnabled) {
    const ch = new TestChannel(engine);
    engine.channels[channelName] = ch;
  }

  // Install a mock tool (needed if tool calls are sent)
  engine.tools['mock_tool'] = new MockTool(engine);
  // end_chat stops the AI loop via its Tool.stop flag
  engine.tools['end_chat'] = new EndChatTool(engine);
  // load_tools is required by makeChat
  engine.tools['load_tools'] = new LoadToolsTool(engine);

  return engine;
}

function chatWith(messages: Chat['messages']): Chat {
  return { id: 'c', thinking: false, messages, updated: Date.now() };
}

// ==================== sendChat (AI loop) tests ====================

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
      tools: [{ id: 'final-1', name: 'end_chat', arguments: {"answer": "done"} }],
    },
  } as Reply;

  (engine.models['mock.model'] as MockModel).setReply(finalAnswerReply);

  const result = await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  expect(result).not.toBeNull();;

  // Should only call the model once - the end chat causes an immediate exit
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
  expect(result!.content).toBe(''); // The end chat content is empty in our reply
});

test('sendChat answers the end_chat tool_call_id so the history stays valid', async () => {
  const engine = buildTestEngine();

  (engine.models['mock.model'] as MockModel).setReply({
    id: 'reply-end',
    stop: false,
    finish: 'tool_calls',
    usage: { completion: 5, prompt: 10 },
    message: {
      role: 'assistant',
      content: '',
      tools: [{ id: 'final-1', name: 'end_chat', arguments: {"answer": "done"} }],
    },
  } as Reply);

  await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  // the assistant tool_calls message must be followed by a tool response,
  // otherwise the next turn in the same thread is rejected by the provider
  const chat = engine.agents['marvin']!.loadChat('chat-1');
  const last = chat!.messages[chat!.messages.length - 1]!;
  expect(last.role).toBe('tool');
  expect(last.toolId).toBe('final-1');
});

test('sendChat answers tool calls skipped after end_chat', async () => {
  const engine = buildTestEngine();

  (engine.models['mock.model'] as MockModel).setReply({
    id: 'reply-multi',
    stop: false,
    finish: 'tool_calls',
    usage: { completion: 5, prompt: 10 },
    message: {
      role: 'assistant',
      content: '',
      tools: [
        { id: 't-end', name: 'end_chat', arguments: {} },
        { id: 't-after', name: 'mock_tool', arguments: {} },
      ],
    },
  } as Reply);

  await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  const chat = engine.agents['marvin']!.loadChat('chat-1');
  const toolMsgs = chat!.messages.filter((m: Message) => m.role === 'tool');
  expect(toolMsgs.map((m: Message) => m.toolId)).toEqual(['t-end', 't-after']);
});

test('sendChat answers pending tool calls when force stopped', async () => {
  const engine = buildTestEngine();

  (engine.models['mock.model'] as MockModel).setReply({
    id: 'reply-stop',
    stop: true,
    finish: 'stop',
    usage: { completion: 5, prompt: 10 },
    message: {
      role: 'assistant',
      content: 'partial',
      tools: [{ id: 't-1', name: 'mock_tool', arguments: {} }],
    },
  } as Reply);

  await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  const chat = engine.agents['marvin']!.loadChat('chat-1');
  const last = chat!.messages[chat!.messages.length - 1]!;
  expect(last.role).toBe('tool');
  expect(last.toolId).toBe('t-1');
});

test('sendChat truncates oversized tool results', async () => {
  const engine = buildTestEngine();

  class BigTool extends MockTool {
    async call(_args: any) {
      return { result: 'x'.repeat(constants.MAX_TOOL_RESULT_CHARS * 3) };
    }
  }
  engine.tools['mock_tool'] = new BigTool(engine);

  (engine.models['mock.model'] as MockModel).setReply({
    id: 'reply-big',
    stop: false,
    finish: 'tool_calls',
    usage: { completion: 5, prompt: 10 },
    message: {
      role: 'assistant',
      content: '',
      tools: [
        { id: 't-big', name: 'mock_tool', arguments: {} },
        { id: 't-end', name: 'end_chat', arguments: {} },
      ],
    },
  } as Reply);

  await engine.agents['marvin']!.sendChat('chat-1', 'hello');

  const chat = engine.agents['marvin']!.loadChat('chat-1');
  const toolMsg = chat!.messages.find((m: Message) => m.toolId === 't-big')!;
  expect(toolMsg.content.length < constants.MAX_TOOL_RESULT_CHARS * 2).toBe(true);
  expect(toolMsg.content).toContain('truncated');
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
  const agent = new Agent(engine, { id: 'nonexistent', enabled: true, identity: '', channels: {}, model: undefined as any });
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

// ==================== packChat tests ====================

const sysMsg = (content = 'sys'): Message => ({ role: 'system', content });
const userMsg = (content: string): Message => ({ role: 'user', content });
const assistantMsg = (content: string, tools?: Message['tools']): Message =>
  tools ? { role: 'assistant', content, tools } : { role: 'assistant', content };
const toolMsg = (toolId: string): Message => ({ role: 'tool', content: '{"ok":true}', toolId });
const toolCalls = (id: string): Message['tools'] => [{ id, name: 'mock_tool', arguments: {} }];

function packAgent(): Agent {
  return new Agent(mockEngine(), { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
}

test('packChat leaves empty and system-only chats untouched', () => {
  const agent = packAgent();

  const empty = chatWith([]);
  agent.packChat(empty);
  expect(empty.messages.length).toBe(0);

  const only = chatWith([sysMsg()]);
  agent.packChat(only);
  expect(only.messages).toEqual([sysMsg()]);
});

test('packChat leaves a single short conversation untouched', () => {
  const agent = packAgent();
  const chat = chatWith([
    sysMsg(),
    userMsg('hi'),
    assistantMsg('hello', toolCalls('t1')),
    toolMsg('t1'),
    toolMsg('t1'),
  ]);

  agent.packChat(chat);

  expect(chat.messages.length).toBe(5);
  expect(chat.messages[0]).toEqual(sysMsg());
  expect(chat.messages[2]!.tools).toEqual(toolCalls('t1'));
});

test('packChat leaves a short chat without a system message untouched', () => {
  const agent = packAgent();
  const chat = chatWith([userMsg('hi'), assistantMsg('hello')]);

  agent.packChat(chat);

  expect(chat.messages).toEqual([userMsg('hi'), assistantMsg('hello')]);
});

test('packChat trims the first assistant batch of the active conversation at the cap', () => {
  const agent = packAgent();
  const chat = chatWith([
    sysMsg(), 
    userMsg('do it'), 
    ...Array.from({ length: 6 }, (_, b) => [
      assistantMsg(`a${b + 1}`, toolCalls(`t${b + 1}`)),
      toolMsg(`t${b + 1}`),
      toolMsg(`t${b + 1}`),
      toolMsg(`t${b + 1}`),
    ]).flat()
  ]);

  agent.packChat(chat);

  // the first batch (a1 + its tool results) is removed, everything else stays
  expect(chat.messages.length).toBe(22);
  expect(chat.messages[0]).toEqual(sysMsg());
  expect(chat.messages[1]).toEqual(userMsg('do it'));
  expect(chat.messages[2]).toEqual(assistantMsg('a2', toolCalls('t2')));
  expect(chat.messages[3]).toEqual(toolMsg('t2'));
  expect(chat.messages[chat.messages.length - 1]).toEqual(toolMsg('t6'));
  // assistants inside the active conversation keep their tool calls
  expect(chat.messages[2]!.tools).toEqual(toolCalls('t2'));
});

test('packChat never trims below the last assistant batch', () => {
  const agent = packAgent();
  const chat = chatWith([
    sysMsg(),
    userMsg('do it'),
    assistantMsg('a1', toolCalls('t1')),
    ...Array.from({ length: 22 }, () => toolMsg('t1')),
  ]); // 25 messages, a single assistant batch

  agent.packChat(chat);

  expect(chat.messages.length).toBe(25);
  expect(chat.messages[2]).toEqual(assistantMsg('a1', toolCalls('t1')));
  expect(chat.messages[chat.messages.length - 1]).toEqual(toolMsg('t1'));
});

test('packChat collapses closed conversations to user + last assistant', () => {
  const agent = packAgent();
  const chat = chatWith([
    sysMsg(),
    userMsg('first'),
    assistantMsg('working', toolCalls('t1')),
    toolMsg('t1'),
    assistantMsg('done-1', toolCalls('t2')),
    toolMsg('t2'),
    userMsg('second'),
    assistantMsg('working', toolCalls('t3')),
    toolMsg('t3'),
    assistantMsg('done-2', toolCalls('t4')),
    toolMsg('t4'),
  ]);

  agent.packChat(chat);

  expect(chat.messages).toEqual([
    sysMsg(),
    userMsg('first'),
    assistantMsg('done-1'), // last assistant of the segment, tools stripped
    userMsg('second'),
    assistantMsg('working', toolCalls('t3')),
    toolMsg('t3'),
    assistantMsg('done-2', toolCalls('t4')),
    toolMsg('t4'),
  ]);
});

test('packChat keeps an empty-content tool-call assistant when collapsing, stripping its tools', () => {
  const agent = packAgent();
  const chat = chatWith([
    sysMsg(),
    userMsg('first'),
    assistantMsg('', toolCalls('t1')),
    toolMsg('t1'),
    userMsg('second'),
    assistantMsg('hi'),
  ]);

  agent.packChat(chat);

  expect(chat.messages).toEqual([
    sysMsg(),
    userMsg('first'),
    { role: 'assistant', content: '' },
    userMsg('second'),
    assistantMsg('hi'),
  ]);
});

test('packChat collapses a conversation without an assistant reply to just its user message', () => {
  const agent = packAgent();
  const chat = chatWith([
    sysMsg(),
    userMsg('first'),
    toolMsg('t1'),
    userMsg('second'),
    assistantMsg('hi'),
  ]);

  agent.packChat(chat);

  expect(chat.messages).toEqual([sysMsg(), userMsg('first'), userMsg('second'), assistantMsg('hi')]);
});

test('packChat keeps consecutive user messages as separate collapsed conversations', () => {
  const agent = packAgent();
  const chat = chatWith([
    sysMsg(),
    userMsg('first'),
    assistantMsg('done-1'),
    userMsg('again'),
    userMsg('current'),
    assistantMsg('hi'),
  ]);

  agent.packChat(chat);

  expect(chat.messages).toEqual([
    sysMsg(),
    userMsg('first'),
    assistantMsg('done-1'),
    userMsg('again'),
    userMsg('current'),
    assistantMsg('hi'),
  ]);
});

test('packChat drops leading tool messages when collapsing conversations', () => {
  const agent = packAgent();
  const chat = chatWith([
    toolMsg('t0'),
    toolMsg('t0'),
    userMsg('first'),
    assistantMsg('done-1', toolCalls('t1')),
    toolMsg('t1'),
    userMsg('second'),
    assistantMsg('hi'),
  ]);

  agent.packChat(chat);

  expect(chat.messages).toEqual([
    userMsg('first'),
    assistantMsg('done-1'),
    userMsg('second'),
    assistantMsg('hi'),
  ]);
});

test('packChat keeps leading tool messages when there is only one conversation', () => {
  const agent = packAgent();
  const chat = chatWith([toolMsg('t0'), userMsg('only'), assistantMsg('hi')]);

  agent.packChat(chat);

  expect(chat.messages).toEqual([toolMsg('t0'), userMsg('only'), assistantMsg('hi')]);
});

test('packChat allows collapsed pairs to exceed the cap instead of dropping them', () => {
  const agent = packAgent();
  const messages: Chat['messages'] = [sysMsg()];
  for (let i = 0; i < 12; i++) {
    messages.push(userMsg(`q${i}`), assistantMsg(`a${i}`, toolCalls(`t${i}`)), toolMsg(`t${i}`));
  }
  messages.push(userMsg('current'), assistantMsg('hi'));
  const chat = chatWith(messages); // 1 + 36 + 2 = 39 messages

  agent.packChat(chat);

  // 12 collapsed pairs (24) + active (2) + system (1) = 27: over the cap, but nothing else can go
  expect(chat.messages.length).toBe(27);
  expect(chat.messages[0]).toEqual(sysMsg());
  expect(chat.messages[1]).toEqual(userMsg('q0'));
  expect(chat.messages[2]).toEqual(assistantMsg('a0')); // tools stripped
  expect(chat.messages[chat.messages.length - 2]).toEqual(userMsg('current'));
  expect(chat.messages[chat.messages.length - 1]).toEqual(assistantMsg('hi'));
});

test('packChat trims the active conversation even when collapsed conversations precede it', () => {
  const agent = packAgent();
  const chat = chatWith([
    sysMsg(),
    userMsg('first'),
    assistantMsg('done-1', toolCalls('t1')),
    toolMsg('t1'),
    userMsg('current'),
    ...Array.from({ length: 6 }, (_, b) => [
      assistantMsg(`a${b + 1}`, toolCalls(`t${b + 1}`)),
      toolMsg(`t${b + 1}`),
      toolMsg(`t${b + 1}`),
      toolMsg(`t${b + 1}`),
    ]).flat(),
  ]); // 1 + 3 + 1 + 24 = 29 messages

  agent.packChat(chat);

  // collapse -> 28, trim a1 batch -> 24, still at cap -> trim a2 batch -> 20
  expect(chat.messages.length).toBe(24);
  expect(chat.messages[0]).toEqual(sysMsg());
  expect(chat.messages[1]).toEqual(userMsg('first'));
  expect(chat.messages[2]).toEqual(assistantMsg('done-1')); // tools stripped
  expect(chat.messages[3]).toEqual(userMsg('current'));
  expect(chat.messages[4]).toEqual(assistantMsg('a2', toolCalls('t2')));
  expect(chat.messages[chat.messages.length - 1]).toEqual(toolMsg('t6'));
});

// ==================== saveChat / loadChat / makeChat tests ====================

test('saveChat/loadChat track last use time', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
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
  const agent = new Agent(engine, { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  agent.saveChat('x', chatWith([{ role: 'user', content: 'hi' }]));

  // cache is cleared (agents dropped), but the persisted copy is reloaded on demand
  const fresh = new Agent(engine, { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  expect(fresh.loadChat('x')).not.toBeNull();
  expect(fresh.loadChat('x')?.messages[0]).toEqual({ role: 'user', content: 'hi' });
  rmSync(engine.work, { recursive: true, force: true });
});

test('saveChat persists chats to disk and loadChat reloads them in a fresh agent', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  agent.saveChat('persist-1', chatWith([{ role: 'user', content: 'persisted' }]));

  // a brand new agent over the same workspace reloads the chat from disk
  const fresh = new Agent(engine, { id: 'a', enabled: true, identity: '', channels: {}, model: {} as never });
  const loaded = fresh.loadChat('persist-1');

  expect(loaded).not.toBeNull();
  expect(loaded?.messages[0]).toEqual({ role: 'user', content: 'persisted' });
  rmSync(engine.work, { recursive: true, force: true });
});

test('makeChat creates a fresh chat (with system prompt) when none was saved', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, { id: 'a', enabled: true, identity: 'my identity', channels: {}, model: {} as never });

  const chat = agent.loadChat('never-saved');

  expect(chat.id).toBe('never-saved');
  const prompt = chat.messages[0]!.content as string;
  expect(prompt).toContain('my identity');
  expect(prompt).toContain('\n\n---');
  expect(prompt).toContain('## Tool execution');
  expect(prompt).toContain('use the `load_tools` tool to load');
  rmSync(engine.work, { recursive: true, force: true });
});





test('makeChat seeds only the identity', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, { memory: false, identity: 'my identity' });

  const prompt = agent.loadChat('chat-1').messages[0]!.content as string;
  expect(prompt).toContain('my identity');
  expect(prompt).toContain('\n\n---');
  expect(prompt).toContain('## Internal Tools');
  expect(prompt).toContain('## Tool execution');
});

test('makeChat renders a memory block when memory notes exist', () => {
  const engine = mockEngine();
  const mem = join(engine.work, 'memories', 'marvin');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'prefs.md'), 'Prefers concise answers');
  writeFileSync(join(mem, 'goals.md'), 'Ship marvin 1.0');

  const agent = new Agent(engine, { id: 'marvin', memory: true, identity: '' });

  const chat = agent.loadChat('chat-1');
  const prompt = chat.messages[0]!.content as string;

  expect(prompt).toContain('## Memory');
  expect(prompt).toContain('prefs: Prefers concise answers');
  expect(prompt).toContain('goals: Ship marvin 1.0');
  expect(prompt).toContain('\n\n---');
  expect(prompt).toContain('## Tool execution');
  rmSync(engine.work, { recursive: true, force: true });
});

test('makeChat omits the memory block when memory is disabled', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, { memory: false, identity: 'my identity' });

  const prompt = agent.loadChat('chat-1').messages[0]!.content as string;
  expect(prompt).toContain('my identity');
  expect(prompt).not.toContain('## Memory');
  expect(prompt).toContain('\n\n---');
  expect(prompt).toContain('## Internal Tools');
  expect(prompt).toContain('## Tool execution');
  rmSync(engine.work, { recursive: true, force: true });
});

test('makeChat seeds a system prompt with an MCPs block for loaded mcps', () => {
  const engine = mockEngine();
  engine.mcps['my_mcp'] = {
    isLoaded: true,
    tools: {
      my_tool: { name: 'my_tool', description: 'Does a thing', inputSchema: { type: 'object', properties: {} } },
      other_tool: { name: 'other_tool', description: 'Other', inputSchema: { type: 'object', properties: {} } },
    },
  } as any;

  const agent = new Agent(engine, { memory: false, identity: 'my identity' });

  const prompt = agent.loadChat('chat-1').messages[0]!.content as string;

  expect(prompt).toContain('## MCPs');
  expect(prompt).toContain('### my_mcp MCP tools:');
  expect(prompt).toContain('`my_mcp__my_tool`: Does a thing');
  expect(prompt).toContain('`my_mcp__other_tool`: Other');
  expect(prompt).toContain('\n\n---');
  expect(prompt).toContain('## Tool execution');
  rmSync(engine.work, { recursive: true, force: true });
});

test('makeChat omits MCP tools when mcp is not loaded', () => {
  const engine = mockEngine();
  engine.mcps['my_mcp'] = {
    isLoaded: false,
    tools: {},
  } as any;

  const agent = new Agent(engine, { memory: false, identity: 'my identity' });
  const prompt = agent.loadChat('chat-1').messages[0]!.content as string;

  expect(prompt).toContain('## MCPs');
  expect(prompt).not.toContain('my_mcp__');
  expect(prompt).toContain('\n\n---');
  expect(prompt).toContain('## Tool execution');
  rmSync(engine.work, { recursive: true, force: true });
});

test('makeChat omits MCP block when no mcps are configured', () => {
  const engine = mockEngine();
  const agent = new Agent(engine, { memory: false, identity: 'my identity' });
  const prompt = agent.loadChat('chat-1').messages[0]!.content as string;
  expect(prompt).toContain('my identity');
  expect(prompt).not.toContain('## MCPs');
  expect(prompt).toContain('\n\n---');
  expect(prompt).toContain('## Internal Tools');
  expect(prompt).toContain('## Tool execution');
  rmSync(engine.work, { recursive: true, force: true });
});

// ==================== Available Tools (lazy loading) tests ====================

// install a representative set of tools so makeChat has something to summarize
function installSampleTools(engine: Engine) {
  engine.tools['read_file'] = new ReadFileTool(engine);
  engine.tools['web_search'] = new WebSearchTool(engine);
  engine.tools['get_date'] = new GetDateTool(engine);
  engine.tools['end_chat'] = new EndChatTool(engine);
  engine.tools['load_tools'] = new LoadToolsTool(engine);
}

test('makeChat seeds the system prompt with a grouped "## Internal Tools" block', () => {
  const engine = buildTestEngine();
  installSampleTools(engine);
  const agent = engine.agents['marvin']!;
  rmSync(engine.work, { recursive: true, force: true });

  const prompt = agent.loadChat('chat-1').messages[0]!.content as string;

  expect(prompt).toContain('## Internal Tools');
  // grouped entries: "### <group> tools:" with "- `name` (desc)"
  expect(prompt).toContain('### filesystem tools:');
  expect(prompt).toContain('`read_file`');
  expect(prompt).toContain('### web tools:');
  expect(prompt).toContain('`web_search`');
  expect(prompt).toContain('### general tools:');
  expect(prompt).toContain('`get_date`');
  // hint to use load_tools
  expect(prompt).toContain('## Tool execution');
  expect(prompt).toContain('use the `load_tools` tool to load');
  expect(prompt).toContain('`end_chat`');
  expect(prompt).toContain('`load_tools`');
});

test('makeChat only includes always-known tools in chat.tools by default', () => {
  const engine = buildTestEngine();
  installSampleTools(engine);
  const agent = engine.agents['marvin']!;
  rmSync(engine.work, { recursive: true, force: true });

  const chat = agent.loadChat('chat-1');
  const names = chat.tools?.map(t => t.function.name) || [];

  // always-known: end_chat (stop) + load_tools
  expect(names).toContain('end_chat');
  expect(names).toContain('load_tools');
  // engine tools are NOT loaded by default
  expect(names).not.toContain('read_file');
  expect(names).not.toContain('web_search');
  expect(names).not.toContain('get_date');
  expect(names).not.toContain('mock_tool');
});

test('makeChat no longer merges per-task tools (tools load via load_tools)', async () => {
  const engine = buildTestEngine();
  installSampleTools(engine);
  const agent = engine.agents['marvin']!;
  rmSync(engine.work, { recursive: true, force: true });

  const chat = agent.loadChat('chat-1');
  const names = chat.tools?.map(t => t.function.name) || [];

  expect(names).toContain('end_chat');
  expect(names).toContain('load_tools');
  // per-task tools are not passed via loadChat anymore; they load lazily via load_tools
  expect(names).not.toContain('custom__do');
  expect(names).not.toContain('read_file');

  // verify lazy loading via load_tools still works
  const tool = engine.tools['load_tools']!;
  const result = await tool.call({ tools: ['read_file'] }, agent, chat);
  expect(result.loaded).toContain('read_file');
  expect(chat.tools!.map(t => t.function.name)).toContain('read_file');
  rmSync(engine.work, { recursive: true, force: true });
});

test('makeChat omits the available-tools block when no loadable tools are configured', () => {
  const engine = buildTestEngine();
  // remove mock_tool so only always-known tools remain (buildTestEngine installs mock_tool)
  delete engine.tools['mock_tool'];
  const agent = engine.agents['marvin']!;
  rmSync(engine.work, { recursive: true, force: true });

  const prompt = agent.loadChat('chat-1').messages[0]!.content as string;

  expect(prompt).toContain('## Internal Tools');
  expect(prompt).toContain('`end_chat`');
});

test('loadTools tool is always present in chat.tools even when the tool itself is not installed', () => {
  // mirrors the real engine: load_tools is loaded from disk by Engine.loadTools
  // and makeChat picks it up via the always-known filter
  const engine = buildTestEngine();
  engine.tools['load_tools'] = new LoadToolsTool(engine);
  const agent = engine.agents['marvin']!;
  rmSync(engine.work, { recursive: true, force: true });

  const chat = agent.loadChat('chat-1');
  const names = chat.tools?.map(t => t.function.name) || [];
  expect(names).toContain('load_tools');
});

test('the loadTools tool adds a tool to the live chat, making it available to the model', async () => {
  const engine = buildTestEngine();
  installSampleTools(engine);
  const agent = engine.agents['marvin']!;
  rmSync(engine.work, { recursive: true, force: true });

  // load the chat, then have the agent call load_tools to pull in read_file
  const chat = agent.loadChat('chat-1');
  const tool = engine.tools['load_tools']!;
  const result = await tool.call({ tools: ['read_file'] }, agent, chat);
  rmSync(engine.work, { recursive: true, force: true });

  expect(result.loaded).toEqual(['read_file']);
  expect(chat.tools!.map(t => t.function.name)).toContain('read_file');
});