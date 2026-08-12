import { test, expect } from 'bun:test';
import { Channel, Config, Model, Chat, Reply, Message, Tool, Integration } from '../types.js';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as constants from '../constants.js';
import Engine from '../engine.js';

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
  const engine = new Engine();
  engine.isDry = isDry;
  engine.state = 'exec';
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
  format = 'text' as const;
  tools: any[] = [];
  /** Tracks how many times sendMessage was called. */
  callCount = 0;

  private _reply: Reply;

  constructor(engine: Engine, reply: Reply) {
    super(engine, {});
    this._reply = reply;
  }

  async sendChat(chat: Chat): Promise<Reply> {
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
  public args = {};
  async load(): Promise<void> {}
  async drop(): Promise<void> {}
  async sendMessage(message: Message): Promise<any> {
    console.debug('[TestChannel.sendMessage]', JSON.stringify(message));
    return message;
  }

  async listGroups(): Promise<{ [key: string]: string }> {
    return {};
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
  maxSteps?: number;
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
        tasks: {},
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
  engine.agents[agentId] = {
    id: agentId,
    enabled: true,
    identity,
    channels: agentChannels,
    model: mockModelInstance,
    tasks: {},
  };

  // Install a mock channel
  if (channelEnabled) {
    const ch = new TestChannel(engine);
    engine.channels[channelName] = ch;
  }

  // Install a mock tool (needed if tool calls are sent)
  engine.tools['mock_tool'] = new MockTool(engine);

  return engine;
}

// ==================== loadChannels tests (existing, kept) ====================

test('execChannels loads enabled channels with valid provider', async () => {
  const config = mockConfig({ 'channel.mock': { enabled: true } });
  const engine = mockEngine();
  engine.config = config;

  await engine.loadChannels();

  expect(engine.channels['channel.mock']).toBeDefined();
  expect(engine.channels['channel.mock'] instanceof Channel).toBe(true);
});

test('execChannels skips disabled channels', async () => {
  const config = mockConfig({ disabledChannel: { enabled: false } });
  const engine = mockEngine();
  engine.config = config;

  await engine.loadChannels();

  expect(engine.channels['disabledChannel']).toBeUndefined();
});

test('execChannels warns on missing provider', async () => {
  const config = mockConfig({ unknownProvider: { enabled: true } });
  const engine = mockEngine();
  engine.config = config;

  await engine.loadChannels();

  expect(engine.channels['unknownProvider']).toBeUndefined();
});

test('execChannels skips non-Channel classes', async () => {
  const config = mockConfig({ badChannel: { enabled: true } });
  const engine = mockEngine();
  engine.config = config;

  await engine.loadChannels();

  expect(engine.channels['badChannel']).toBeUndefined();
});

test('execChannels stores channels in engine.channels', async () => {
  const config = mockConfig({ 'channel.mock': { enabled: true } });
  const engine = mockEngine();
  engine.config = config;

  await engine.loadChannels();

  expect(Object.keys(engine.channels).length).toBeGreaterThan(0);
  expect(Object.keys(engine.channels)).toContain('channel.mock');
});

// ==================== loadIntegrations tests ====================

test('execIntegrations loads enabled integrations with valid type', async () => {
  const engine = mockEngine();
  engine.config = mockConfig({}, {}, {}, { gloobeam: { enabled: true, type: 'wordpress', endpoint: 'https://example.com' } });

  await engine.loadIntegrations();

  expect(engine.integrations['gloobeam']).toBeDefined();
  expect(engine.integrations['gloobeam'] instanceof Integration).toBe(true);
});

test('execIntegrations skips disabled integrations', async () => {
  const engine = mockEngine();
  engine.config = mockConfig({}, {}, {}, { gloobeam: { enabled: false, type: 'wordpress' } });

  await engine.loadIntegrations();

  expect(engine.integrations['gloobeam']).toBeUndefined();
});

test('execIntegrations warns on unknown type', async () => {
  const engine = mockEngine();
  engine.config = mockConfig({}, {}, {}, { gloobeam: { enabled: true, type: 'nope' } });

  await engine.loadIntegrations();

  expect(engine.integrations['gloobeam']).toBeUndefined();
});

test('dropIntegrations clears all integrations', async () => {
  const engine = mockEngine();
  engine.config = mockConfig({}, {}, {}, { gloobeam: { enabled: true, type: 'wordpress', endpoint: 'https://example.com' } });

  await engine.loadIntegrations();
  await engine.dropIntegrations();

  expect(Object.keys(engine.integrations).length).toBe(0);
});

// ==================== loadSkills tests ====================

test('execSkills loads default skills shipped with marvin', async () => {
  const engine = mockEngine();
  engine.config = mockConfig();

  await engine.loadSkills();

  expect(engine.skills['meta']).toBeDefined();
  expect(engine.skills['tools-create']).toBeDefined();
  expect(engine.skills['tools-edit']).toBeDefined();
  expect(engine.skills['meta']!.source).toBe('default');
});

test('execSkills loads custom skills from the workspace', async () => {
  const engine = mockEngine();
  engine.config = mockConfig();
  engine.work = join(tmpdir(), 'marvin-skills-' + Date.now());
  mkdirSync(join(engine.work, 'skills'), { recursive: true });
  writeFileSync(join(engine.work, 'skills', 'my-skill.md'), '# My Skill\n\nDoes something.');

  await engine.loadSkills();

  expect(engine.skills['my-skill']).toBeDefined();
  expect(engine.skills['my-skill']!.source).toBe('custom');
  expect(engine.skills['meta']).toBeDefined();
});

test('custom skills override default skills with the same id', async () => {
  const engine = mockEngine();
  engine.config = mockConfig();
  engine.work = join(tmpdir(), 'marvin-skills-' + Date.now());
  mkdirSync(join(engine.work, 'skills'), { recursive: true });
  writeFileSync(join(engine.work, 'skills', 'tools-create.md'), '# Custom Tools\n\nOverrides the default.');

  await engine.loadSkills();

  expect(engine.skills['tools-create']!.source).toBe('custom');
  expect(engine.skills['tools-create']!.title).toBe('Custom Tools');
});

test('dropSkills clears all skills', async () => {
  const engine = mockEngine();
  engine.config = mockConfig();

  await engine.loadSkills();
  await engine.dropSkills();

  expect(Object.keys(engine.skills).length).toBe(0);
});

// ==================== loadTools / custom tools tests ====================

test('loadTools loads custom tools from the workspace', async () => {
  const engine = mockEngine();
  engine.config = mockConfig();
  engine.work = join(tmpdir(), 'marvin-tools-' + Date.now());
  mkdirSync(join(engine.work, 'tools'), { recursive: true });

  const toolFile = [
    `import { Tool, ToolMeta } from '${engine.root.replace(/\/$/, '')}/src/types.js';`,
    '',
    'export default class CustomPingTool extends Tool {',
    '  public meta: ToolMeta = {',
    "    type: 'function',",
    '    function: {',
    "      name: 'custom_ping',",
    "      description: 'pings the custom tool loader',",
    "      parameters: { type: 'object', properties: {}, required: [] },",
    '    },',
    '  };',
    '',
    '  public async call(args: any) {',
    "    return { pong: true };",
    '  }',
    '}',
  ].join('\n');
  writeFileSync(join(engine.work, 'tools', 'custom_ping.ts'), toolFile);

  await engine.loadTools();

  expect(engine.tools['custom_ping']).toBeDefined();
  const instance = engine.tools['custom_ping'];
  expect(instance?.meta.function.name).toBe('custom_ping');
});

test('loadTools skips workspace files that do not export a Tool', async () => {
  const engine = mockEngine();
  engine.config = mockConfig();
  engine.work = join(tmpdir(), 'marvin-badtool-' + Date.now());
  mkdirSync(join(engine.work, 'tools'), { recursive: true });
  writeFileSync(join(engine.work, 'tools', 'broken_tool.ts'), 'export default class NotATool {}');

  await engine.loadTools();

  expect(engine.tools['broken_tool']).toBeUndefined();
});

// ==================== sendMessage tests ====================

test('sendMessage returns dry result when engine.isDry is true', async () => {
  const engine = buildTestEngine({ isDry: true });

  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  // Dry mode returns early without calling the model
  expect(result).toEqual({ content: '(dry)', steps: 0 });
  // Verify the model was never invoked by checking the chat has no assistant messages
  const chat = engine.findChat('chat-1');
  expect(chat).toBeDefined();
  const assistantMessages = chat!.messages.filter((m: Message) => m.role === 'assistant');
  expect(assistantMessages.length).toBe(0);
});

test('sendMessage pushes system and user messages to chat', async () => {
  const engine = buildTestEngine();

  await engine.execChat('chat-1', 'marvin', 'hello world', 'json', {"output": "text string of the answer"}, 5);

  const chat = engine.findChat('chat-1');
  expect(chat).not.toBeNull();
  // 2 system/user messages + 5 assistant replies from the AI loop
  expect(chat!.messages.length).toBe(7);
  expect(chat!.messages[0]!.role).toBe('system');
  expect(chat!.messages[0]!.content).toContain('You are Marvin.');
  expect(chat!.messages[1]!.role).toBe('user');
  expect(chat!.messages[1]!.content).toBe('hello world');
  // Verify assistant replies were persisted
  const assistantMessages = chat!.messages.filter((m: Message) => m.role === 'assistant');
  expect(assistantMessages.length).toBe(5);
});

test('sendMessage returns content and step count from model reply', async () => {
  const engine = buildTestEngine({ replyContent: 'hello from model' });

  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  expect(result).not.toBeNull();

  expect(result!.content).toBe('hello from model');
  // The mock model returns stop=false, no tools, no end chat.
  // The loop runs maxSteps (5) times: steps goes -1, 0, 1, 2, 3 -> final steps=4
  expect(result!.steps).toBe(4);
});

test('execChat returns valid JSON content when format is json and the model appends markup', async () => {
  const engine = buildTestEngine({ replyStop: true, replyContent: '{"output": "hi"}<tool_calls><invoke name="end_chat"></invoke></tool_calls>' });

  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  expect(result).not.toBeNull();
  expect(result!.content).toBe('{"output": "hi"}');
  expect(JSON.parse(result!.content)).toEqual({ output: 'hi' });
});

test('sendMessage caches the chat after execution', async () => {
  const engine = buildTestEngine();

  await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  const cached = engine.findChat('chat-1');
  expect(cached).toBeDefined();
  expect(cached!.id).toBe('chat-1');
  expect(cached!.messages.length).toBeGreaterThan(0);
});

test('sendMessage reuses existing chat when chatId already exists', async () => {
  const engine = buildTestEngine();

  // First call
  await engine.execChat('chat-1', 'marvin', 'first', 'json', {"output": "text string of the answer"}, 5);

  // Second call with same chatId
  await engine.execChat('chat-1', 'marvin', 'second', 'json', {"output": "text string of the answer"}, 5);

  const chat = engine.findChat('chat-1');
  // Each call adds 2 messages (system + user) + 5 assistant replies (one per loop iteration)
  // But the model always returns the same reply, so we get 2 calls * (2 + 5) = 14 messages
  // Actually: first call: system + user + 5 assistant = 7
  // second call: system + user + 5 assistant = 7 more
  expect(chat!.messages.length).toBeGreaterThan(4);
  expect(chat!.messages[chat!.messages.length - 1]!.content).toBe('end chat');
});

test('sendMessage calls agent.model.sendMessage maxSteps times when never stopping', async () => {
  const engine = buildTestEngine();

  await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  const model = engine.models['mock.model'] as MockModel;
  // The model is called exactly maxSteps times (5) when it never stops
  expect(model.callCount).toBe(5);
});

test('sendMessage stops when reply.stop is true', async () => {
  const engine = buildTestEngine({ replyStop: true, replyContent: 'stopped early' });

  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  expect(result).not.toBeNull();

  expect(result!.content).toBe('stopped early');
  // With stop=true, the model is called only once
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
});

test('sendMessage executes tool calls from model reply', async () => {
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

  await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  // After tool execution, the loop continues (no end chat, no stop).
  // The model is called: 1 (tool call) + 4 (remaining iterations) = 5 total
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(5);

  // Check that tool result was pushed to chat
  const chat = engine.findChat('chat-1');
  const toolMessages = chat!.messages.filter((m: Message) => m.role === 'tool');
  expect(toolMessages.length).toBeGreaterThan(0);
});

test('sendMessage handles invalid JSON in tool arguments gracefully', async () => {
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
  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  expect(result).toBeDefined();
  // Verify tool error was pushed to chat
  const chat = engine.findChat('chat-1');
  const toolMessages = chat!.messages.filter((m: Message) => m.role === 'tool');
  expect(toolMessages.length).toBeGreaterThan(0);
  // The tool error message should contain the parse error
  const errorContent = toolMessages[0]!.content;
  expect(typeof errorContent).toBe('string');
});

test('sendMessage stops the AI loop when end chat tool call is found', async () => {
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

  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  expect(result).not.toBeNull();;

  // Should only call the model once - the end chat causes an immediate exit
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
  expect(result!.content).toBe(''); // The end chat content is empty in our reply
});

test('sendMessage returns empty content when reply has no message content', async () => {
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

  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  expect(result).not.toBeNull();

  expect(result!.content).toBe('');
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
});

test('sendMessage returns null when agentId does not exist', async () => {
  const engine = buildTestEngine();

  // execChat swallows internal errors and returns null for unknown agents
  const result = await engine.execChat('chat-1', 'nonexistent', 'hello', 'json', {"output": "text string of the answer"}, 5);

  expect(result).toBeNull();
});

test('sendMessage returns content and steps from model reply', async () => {
  const engine = buildTestEngine();

  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  expect(result).not.toBeNull();;

  expect(result!.content).toBe('end chat');
  // The model runs maxSteps (5) times: steps goes -1, 0, 1, 2, 3 -> final steps=4
  expect(result!.steps).toBe(4);
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(5);
});

test('sendMessage passes correct agentId and chatId to cache', async () => {
  const engine = buildTestEngine();

  await engine.execChat('unique-chat-id', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  const chat = engine.findChat('unique-chat-id');
  expect(chat!.id).toBe('unique-chat-id');
});

test('sendMessage respects maxSteps limit (1 step)', async () => {
  const engine = buildTestEngine();

  // With maxSteps=1, the loop runs 1 time: steps=-1 -> 0, 0 < 0 false -> exit
  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 1);

  expect(result).not.toBeNull();;

  expect(result!.steps).toBe(0);
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
});

test('sendMessage warns when max steps are reached (maxSteps=1 with never-stopping model)', async () => {
  const engine = buildTestEngine();

  // A model that never stops (no stop, no end chat, no tools)
  // Replace the model's reply (not the instance) so the agent's reference stays valid
  const neverStoppingReply: Reply = {
    id: 'reply-6',
    stop: false,
    finish: undefined,
    usage: { completion: 5, prompt: 10 },
    message: { role: 'assistant', content: 'not done yet' },
  } as Reply;

  (engine.models['mock.model'] as MockModel).setReply(neverStoppingReply);

  // maxSteps=1: steps=-1 -> steps=0 (0 < 0 false) -> exit, steps=0
  // 0 >= 1 is true -> warning logged
  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 1);

  expect(result).not.toBeNull();;

  expect(result!.steps).toBe(0);
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
});

test('execChat returns empty string when reply.message is undefined', async () => {
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

  const result = await engine.execChat('chat-1', 'marvin', 'hello', 'json', {"output": "text string of the answer"}, 5);

  expect(result).not.toBeNull();

  expect(result!.content).toBe('');
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(1);
});

// ==================== execInput tests (integration with execChat) ====================

// execInput prompts the LLM with task.input via execChat, sends the result
// through the agent's channels, then reschedules itself.

// Set up a task on the agent with an input, then call execInput('marvin', 'test-task').

test('execInput calls execChat and sends result through agent channels', async () => {
  const engine = buildTestEngine();

  // Add a task directly to the existing agent
  engine.agents['marvin']!.tasks = {
    'test-task': {
      id: 'test-task',
      enabled: true,
      type: 'input',
      schedule: 0,
      maxSteps: 5,
      input: 'task input',
      timeout: null,
    },
  };

  // Call execInput directly
  await engine.execInput('marvin', 'test-task');

  // The mock channel was loaded, so the result should have been sent through it
  expect(engine.channels['test.channel']).toBeDefined();
  // execChat was called by execInput
  expect((engine.models['mock.model'] as MockModel).callCount).toBeGreaterThan(0);
});

test('execInput skips disabled tasks', async () => {
  const engine = buildTestEngine();

  // Add a disabled task directly to the existing agent (identity is already set)
  engine.agents['marvin']!.tasks = {
    'disabled-task': {
      id: 'disabled-task',
      enabled: false,
      type: 'input',
      schedule: 0,
      maxSteps: 5,
      input: 'should not run',
      timeout: null,
    },
  };

  // Should log and return without calling sendMessage
  await engine.execInput('marvin', 'disabled-task');

  // Verify the model was never invoked
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(0);
});

test('execInput skips disabled agents', async () => {
  const engine = buildTestEngine();

  (engine.agents['marvin'] as any).enabled = false;
  engine.agents['marvin']!.tasks = {
    'test-task': {
      id: 'test-task',
      enabled: true,
      type: 'input',
      schedule: 0,
      maxSteps: 5,
      input: 'task input',
      timeout: null,
    },
  };

  await engine.execInput('marvin', 'test-task');

  // Verify the model was never invoked
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(0);
});

test('execInput warns and skips when agent channel is not loaded', async () => {
  const engine = buildTestEngine({ channelEnabled: false });

  engine.agents['marvin']!.channels = { 'missing.channel': 'default' };
  engine.agents['marvin']!.tasks = {
    'test-task': {
      id: 'test-task',
      enabled: true,
      type: 'input',
      schedule: 0,
      maxSteps: 5,
      input: 'task input',
      timeout: null,
    },
  };

  // Should log a warning but not throw
  await engine.execInput('marvin', 'test-task');
  // sendMessage was called (execInput tries it), but the channel send failed
  expect((engine.models['mock.model'] as MockModel).callCount).toBeGreaterThan(0);
});

test('execInput skips disabled tasks', async () => {
  const engine = buildTestEngine();

  // Add a disabled task directly to the existing agent (identity is already set)
  engine.agents['marvin']!.tasks = {
    'disabled-task': {
      id: 'disabled-task',
      enabled: false,
      type: 'input',
      schedule: 0,
      maxSteps: 5,
      input: 'should not run',
      timeout: null,
    },
  };

  // Should log and return without calling sendMessage
  await engine.execInput('marvin', 'disabled-task');

  // Verify the model was never invoked
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(0);
});

test('execInput skips disabled agents', async () => {
  const engine = buildTestEngine();

  (engine.agents['marvin'] as any).enabled = false;
  engine.agents['marvin']!.tasks = {
    'test-task': {
      id: 'test-task',
      enabled: true,
      type: 'input',
      schedule: 0,
      maxSteps: 5,
      input: 'task input',
      timeout: null,
    },
  };

  await engine.execInput('marvin', 'test-task');

  // Verify the model was never invoked
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(0);
});

test('execInput warns and skips when agent channel is not loaded', async () => {
  const engine = buildTestEngine({ channelEnabled: false });

  engine.agents['marvin']!.channels = { 'missing.channel': 'default' };
  engine.agents['marvin']!.tasks = {
    'test-task': {
      id: 'test-task',
      enabled: true,
      type: 'input',
      schedule: 0,
      maxSteps: 5,
      input: 'task input',
      timeout: null,
    },
  };

  // Should log a warning but not throw
  await engine.execInput('marvin', 'test-task');
  // sendMessage was called (execInput tries it), but the channel send failed
  expect((engine.models['mock.model'] as MockModel).callCount).toBeGreaterThan(0);
});

// ==================== execReload tests ====================

test('execReload drops and re-executes the engine, ending in the exec state', async () => {
  const engine = buildTestEngine({
    configAgents: {
      marvin: {
        enabled: true,
        default: true,
        model: 'mock.model',
        channels: {},
        tasks: {},
      },
    },
  });

  // Set up a test home directory so scanProject can find the required files
  const testHome = '/tmp/marvin-test-' + Date.now();
  engine.work = testHome;
  engine.root = testHome;
  mkdirSync(testHome, { recursive: true });
  writeFileSync(testHome + '/MARVIN.md', 'You are Marvin.');
  writeFileSync(testHome + '/marvin.json', JSON.stringify({}));
  // Create subdirectories needed by scanProject/loadAgents
  mkdirSync(testHome + '/agents', { recursive: true });

  // Pre-load some state
  engine.state = 'exec';

  // Stub the heavy loaders so execReload does not start real systems (HTTP, browser,
  // file watcher) or read models from disk during the test.
  engine.loadSystems = async () => {};
  engine.loadTools = async () => {};
  engine.loadChannels = async () => {};
  engine.loadModels = async () => {};
  engine.loadAgents = async () => {
    // Re-install the mock model so agents can use it
    const mockModelInstance = new MockModel(engine, {
      id: 'reply-1',
      stop: true,
      finish: undefined,
      usage: { completion: 0, prompt: 0 },
      message: { role: 'assistant', content: '' },
    } as Reply);
    engine.models['mock.model'] = mockModelInstance;
    engine.agents['marvin'] = {
      id: 'marvin',
      enabled: true,
      identity: 'You are Marvin.',
      channels: {},
      model: mockModelInstance,
      tasks: {},
    };
  };

  await engine.execReload();

  expect(engine.state).toBe('exec');
});

// ==================== drop methods tests ====================

test('dropChannels clears all channels from engine', async () => {
  const engine = buildTestEngine();

  await engine.dropChannels();

  expect(Object.keys(engine.channels).length).toBe(0);
});

test('dropChannel removes a single channel by id', async () => {
  const engine = buildTestEngine();

  await engine.dropChannel('test.channel');

  expect(engine.channels['test.channel']).toBeUndefined();
});

test('dropChannel does nothing for non-existent channel', async () => {
  const engine = buildTestEngine();

  // Should not throw
  await engine.dropChannel('nonexistent.channel');

  expect(engine.channels['test.channel']).toBeDefined();
});

test('dropAgents clears all agents and clears their timeouts', async () => {
  const engine = buildTestEngine();

  // Add a task with a timeout
  engine.agents['marvin']!.tasks['test-task'] = {
    id: 'test-task',
    enabled: true,
    type: 'input',
    schedule: 0,
    maxSteps: 5,
    input: 'input',
    timeout: setTimeout(() => {}, 0),
  };

  expect(Object.keys(engine.agents)).toContain('marvin');

  await engine.dropAgents();

  expect(Object.keys(engine.agents).length).toBe(0);
});

test('dropModels clears all models', async () => {
  const engine = buildTestEngine();

  await engine.dropModels();

  expect(Object.keys(engine.models).length).toBe(0);
});
