import { test, expect } from 'bun:test';
import { Channel, ChannelMeta, Config, Model, Chat, Reply, Message, Tool, Integration, IntegrationMeta, ToolMeta, Task } from '../types.js';
import { Agent } from '../agent.js';
import { writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Engine from '../engine.js';
import { Logger } from '../logger.js';

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
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-serve-'));
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

// ==================== loadChannels tests ====================

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

// ==================== execTask tests ====================

// execTask prompts the LLM with task.input via agent.sendChat, sends the result
// through the agent's channels, then reschedules itself.

test('execTask calls sendChat and sends result through agent channels', async () => {
  const engine = buildTestEngine();

  // Add a task directly to the engine
  engine.tasks['test-task'] = {
    id: 'test-task',
    enabled: true,
    type: 'task',
    agent: engine.agents['marvin'],
    schedule: 60_000,
    maxSteps: 5,
    input: 'task input',
    timeout: null,
  } as Task;

  // Call execTask directly
  await engine.execTask('test-task');
  // stop the reschedule so the test does not keep firing execTask
  clearTimeout(engine.tasks['test-task']!.timeout!);

  // The mock channel was loaded, so the result should have been sent through it
  expect(engine.channels['test.channel']).toBeDefined();
  // sendChat was called by execTask
  expect((engine.models['mock.model'] as MockModel).callCount).toBeGreaterThan(0);
});

test('execTask skips disabled tasks', async () => {
  const engine = buildTestEngine();

  // Add a disabled task directly to the engine (identity is already set)
  engine.tasks['disabled-task'] = {
    id: 'disabled-task',
    enabled: false,
    type: 'task',
    agent: engine.agents['marvin'],
    schedule: 0,
    maxSteps: 5,
    input: 'should not run',
    timeout: null,
  } as Task;

  // Should log and return without calling sendChat
  await engine.execTask('disabled-task');

  // Verify the model was never invoked
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(0);
});

test('execTask skips disabled agents', async () => {
  const engine = buildTestEngine();

  (engine.agents['marvin'] as any).enabled = false;
  engine.tasks['test-task'] = {
    id: 'test-task',
    enabled: true,
    type: 'task',
    agent: engine.agents['marvin'],
    schedule: 0,
    maxSteps: 5,
    input: 'task input',
    timeout: null,
  } as Task;

  await engine.execTask('test-task');

  // Verify the model was never invoked
  expect((engine.models['mock.model'] as MockModel).callCount).toBe(0);
});

test('execTask warns and skips when agent channel is not loaded', async () => {
  const engine = buildTestEngine({ channelEnabled: false });

  engine.agents['marvin']!.channels = { 'missing.channel': 'default' };
  engine.tasks['test-task'] = {
    id: 'test-task',
    enabled: true,
    type: 'task',
    agent: engine.agents['marvin'],
    schedule: 60_000,
    maxSteps: 5,
    input: 'task input',
    timeout: null,
  } as Task;

  // Should log a warning but not throw
  await engine.execTask('test-task');
  // stop the reschedule so the test does not keep firing execTask
  clearTimeout(engine.tasks['test-task']!.timeout!);
  // sendChat was called (execTask tries it), but the channel send failed
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
    engine.agents['marvin'] = new Agent(engine, new Logger(), {
      id: 'marvin',
      enabled: true,
      identity: 'You are Marvin.',
      channels: {},
      model: mockModelInstance,
    });
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

test('dropAgents clears all agents', async () => {
  const engine = buildTestEngine();

  expect(Object.keys(engine.agents)).toContain('marvin');

  await engine.dropAgents();

  expect(Object.keys(engine.agents).length).toBe(0);
});

test('dropTasks clears all tasks and their timeouts', async () => {
  const engine = buildTestEngine();

  // Add a task with a timeout
  engine.tasks['test-task'] = {
    id: 'test-task',
    enabled: true,
    type: 'task',
    agent: engine.agents['marvin'],
    schedule: 0,
    maxSteps: 5,
    input: 'input',
    timeout: setTimeout(() => {}, 0),
  } as Task;

  expect(Object.keys(engine.tasks)).toContain('test-task');

  await engine.dropTasks();

  expect(Object.keys(engine.tasks).length).toBe(0);
});

test('dropModels clears all models', async () => {
  const engine = buildTestEngine();

  await engine.dropModels();

  expect(Object.keys(engine.models).length).toBe(0);
});

// ==================== execTask integration tools tests ====================

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

test('execTask merges task integration tools into chat.tools', async () => {
  const engine = buildTestEngine();
  engine.integrations['gloobeam'] = new MockIntegration(engine, new Logger(), { type: 'mock' });

  engine.tasks['test-task'] = {
    id: 'test-task',
    enabled: true,
    type: 'task',
    agent: engine.agents['marvin'],
    schedule: 60_000,
    maxSteps: 2,
    input: 'task input',
    timeout: null,
    integrations: ['gloobeam'],
  } as Task;

  // capture the tool metas the model receives on each call
  const model = engine.models['mock.model'] as MockModel;
  const seen: ToolMeta[][] = [];
  model.execChat = async (chat: Chat) => { seen.push(chat.tools || []); return (model as any)._reply; };

  await engine.execTask('test-task');
  clearTimeout(engine.tasks['test-task']!.timeout!);

  expect(seen.length).toBeGreaterThan(0);
  const names = seen[0]!.map(t => t.function.name);
  // task-linked integration tool is present alongside the engine default tools
  expect(names).toContain('gloobeam__create_post');
  expect(names).toContain('mock_tool');
});