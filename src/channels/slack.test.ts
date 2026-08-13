import { test, expect } from 'bun:test';
import { ChatPostMessageArguments, ChatPostMessageResponse } from '@slack/web-api';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { Config, Message, Agent, Model, Chat, Reply } from '../types.js';
import SlackChannel from './slack.js';
import { type HandlerParams, type ISocketModeClient, type IWebClient } from './slack.js'
import GetDateTool from '../tools/get_date.js';

// ============================================================================
// Mocks - Slack SDK clients + LLM model (no real external calls)
// ============================================================================

class MockSocketModeClient implements ISocketModeClient {
  public started = false;
  private handlers: Record<string, Array<(...args: any[]) => any>> = {};

  on(event: string, handler: (...args: any[]) => any) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event]!.push(handler);
  }

  async start() {
    this.started = true;
  }

  async disconnect() {
    this.started = false;
  }

  async emit(event: string, ...args: unknown[]) {
    const handlers = this.handlers[event];
    if (!handlers) return;
    for (const handler of handlers) {
      await handler(...args);
    }
  }
}

interface PostMessageCall {
  channel?: string;
  thread_ts?: string;
  text?: string;
}

class MockWebClient implements IWebClient {
  public postMessageCalls: PostMessageCall[] = [];
  public postMessageResult: ChatPostMessageResponse | null = null;
  public conversationListResult: any = { ok: true, channels: [] };
  public authTestResult: any = { ok: true, user_id: 'U12345678' };
  public connectionsOpenResult: any = { ok: true, url: 'wss://example.com/conn' };

  setPostMessageResult(result: ChatPostMessageResponse) {
    this.postMessageResult = result;
  }

  setConversationListResult(result: any) {
    this.conversationListResult = result;
  }

  setAuthTestResult(result: any) {
    this.authTestResult = result;
  }

  setConnectionsOpenResult(result: any) {
    this.connectionsOpenResult = result;
  }

  public chat = {
    postMessage: async (args: ChatPostMessageArguments): Promise<ChatPostMessageResponse> => {
      this.postMessageCalls.push(args);
      return this.postMessageResult!;
    },
  };

  public conversations = {
    list: async (): Promise<any> => {
      return this.conversationListResult;
    },
  };

  public auth = {
    test: async (): Promise<any> => {
      return this.authTestResult;
    },
  };

  public apps = {
    connections: {
      open: async (): Promise<any> => {
        return this.connectionsOpenResult;
      },
    },
  };
}

// MockSlackChannel only replaces load() to inject the mocked SDK clients.
// All handlers (onMention, onDirectMessage, sendMessage, ...) run the REAL code.
class MockSlackChannel extends SlackChannel {
  public mockSok: MockSocketModeClient;
  public mockWeb: MockWebClient;

  constructor(engine: Engine, logger?: Logger) {
    super(engine, logger);
    this.mockSok = new MockSocketModeClient();
    this.mockWeb = new MockWebClient();
  }

  async load() {
    this.sok = this.mockSok;
    this.web = this.mockWeb;
    this.botId = this.mockWeb.authTestResult?.user_id || '';

    this.sok.on('error', this.onError.bind(this) as (...args: any[]) => any);
    this.sok.on('connecting', this.onConnecting.bind(this) as (...args: any[]) => any);
    this.sok.on('connected', this.onConnected.bind(this) as (...args: any[]) => any);
    this.sok.on('reconnecting', this.onReconnecting.bind(this) as (...args: any[]) => any);
    this.sok.on('reconnected', this.onReconnected.bind(this) as (...args: any[]) => any);
    this.sok.on('disconnected', this.onDisconnected.bind(this) as (...args: any[]) => any);
    this.sok.on('app_mention', this.onMention.bind(this) as (...args: any[]) => any);
    this.sok.on('message', this.onSocketMessage.bind(this) as (...args: any[]) => any);
    this.sok.on('slash_commands', this.onSlashCommand.bind(this) as (...args: any[]) => any);

    await this.sok.start();
  }

  // expose protected members for tests
  findAgent(channel?: string): Agent {
    return super.findAgent(channel);
  }

  extractText(event: { [key: string]: any }): string {
    return super.extractText(event);
  }

  setBotId(id: string) {
    this.botId = id;
  }

  checkPrereqs(appToken: string | undefined, botToken: string | undefined) {
    this.web = this.mockWeb;
    return super.checkPrereqs(appToken, botToken);
  }

  async onError(err: Error) { return super.onError(err); }
  async onConnecting() { return super.onConnecting(); }
  async onConnected() { return super.onConnected(); }
  async onReconnecting(n: number) { return super.onReconnecting(n); }
  async onReconnected() { return super.onReconnected(); }
  async onDisconnected(err: Error) { return super.onDisconnected(err); }
}

// A real Model subclass that returns a controllable list of replies.
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

  callCount = 0;
  fail = false;
  private replies: Reply[];

  constructor(engine: Engine, replies: Reply[] = []) {
    super(engine, new Logger(), {});
    this.replies = replies;
  }

  async sendChat(_chat: Chat): Promise<Reply> {
    this.callCount++;
    if (this.fail) {
      throw new Error('mock model failure');
    }
    const reply = this.replies.shift();
    if (reply) return reply;
    return {
      id: 'default',
      stop: true,
      finish: 'stop',
      usage: { completion: 0, prompt: 0 },
      message: { role: 'assistant', content: '(default reply)' },
    } as Reply;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function reply(content: string, opts: { stop?: boolean; tools?: Message['tools'] } = {}): Reply {
  return {
    id: 'r-' + Math.random().toString(36).slice(2, 8),
    stop: opts.stop ?? true,
    finish: 'stop',
    usage: { completion: 1, prompt: 1 },
    message: { role: 'assistant', content, tools: opts.tools },
  } as Reply;
}

function mockConfig(options: {
  channels?: Config['channels'];
  agents?: Config['agents'];
} = {}): Config {
  return {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', apiToken: 'changeme' },
    channels: options.channels || {},
    integrations: {},
    models: {},
    agents: options.agents || {},
  };
}

function buildEngine(opts: { replies?: Reply[]; fail?: boolean } = {}): { engine: Engine; model: MockModel; channel: MockSlackChannel } {
  const engine = new Engine(new Logger());
  engine.isDry = false;
  engine.state = 'exec';
  engine.tools['get_date'] = new GetDateTool(engine, new Logger());

  engine.config = mockConfig({
    channels: { slack: { enabled: true, appToken: 'xapp-test', botToken: 'xbot-test' } },
    agents: { marvin: { enabled: true, channels: { slack: 'C123' }, tasks: {} } },
  });

  const model = new MockModel(engine, opts.replies || []);
  model.fail = !!opts.fail;
  engine.models['mock.model'] = model;

  engine.agents['marvin'] = {
    id: 'marvin',
    enabled: true,
    identity: 'You are Marvin.',
    channels: { slack: 'C123' },
    model: model,
    tasks: {},
  } as Agent;

  const channel = new MockSlackChannel(engine);
  return { engine, model, channel };
}

// a logger that captures every emitted line (info-level and up), so tests can
// assert on command output without patching console.*
function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = new Logger({ level: 'info', output: (_level, args) => lines.push(args.map(String).join(' ')) });
  return { logger, lines };
}

// build a channel wired to the mock Slack SDK clients with an injected logger
function buildChannel(logger: Logger = new Logger()): MockSlackChannel {
  const channel = new MockSlackChannel(new Engine(new Logger()), logger);
  return channel;
}

function mentionEvent(overrides: { [key: string]: any } = {}): { event: any; body: any; ack: () => Promise<void> } {
  return {
    event: {
      type: 'app_mention',
      text: '<@U12345678> hello marvin',
      channel: 'C123',
      ts: '1700000000.001',
      thread_ts: '1700000000.001',
      event_ts: '1700000000.001',
      ...overrides,
    },
    body: { callback_id: 'app_mention' },
    ack: async () => {},
  };
}

// ============================================================================
// extractText tests (real implementation, exposed via MockSlackChannel)
// ============================================================================

test('extractText returns raw text when no mention present', () => {
  const { channel } = buildEngine();
  expect(channel.extractText({ text: 'hello world' })).toBe('hello world');
});

test('extractText strips the bot\'s own mention from text', () => {
  const { channel } = buildEngine();
  channel.setBotId('U12345678');
  expect(channel.extractText({ text: '<@U12345678> hello there' })).toBe('hello there');
});

test('extractText handles text with only a bot mention', () => {
  const { channel } = buildEngine();
  channel.setBotId('U12345678');
  expect(channel.extractText({ text: '<@U12345678>' })).toBe('');
});

test('extractText strips only the bot mention, keeping other users mentions', () => {
  const { channel } = buildEngine();
  channel.setBotId('U222');
  expect(channel.extractText({ text: '<@U111><@U222> hello friends' })).toBe('<@U111> hello friends');
});

test('extractText keeps mentions when the bot id is unknown', () => {
  const { channel } = buildEngine();
  expect(channel.extractText({ text: '<@U12345678> hello there' })).toBe('<@U12345678> hello there');
});

test('extractText handles missing text field', () => {
  const { channel } = buildEngine();
  expect(channel.extractText({})).toBe('');
});

test('extractText preserves links and formatting', () => {
  const { channel } = buildEngine();
  channel.setBotId('U12345678');
  expect(channel.extractText({ text: '<@U12345678> check <http://example.com|this link> *bold* :smile:' }))
    .toBe('check <http://example.com|this link> *bold* :smile:');
});

// ============================================================================
// findAgent tests (real implementation)
// ============================================================================

test('findAgent returns agent whose channels.slack matches the passed channel', () => {
  const engine = new Engine(new Logger());
  engine.agents['agent-1'] = { id: 'agent-1', enabled: true, identity: '', channels: { slack: 'C123' }, tasks: {}, model: {} as never } as Agent;
  engine.agents['agent-2'] = { id: 'agent-2', enabled: true, identity: '', channels: { slack: 'C456' }, tasks: {}, model: {} as never } as Agent;

  const channel = new MockSlackChannel(engine);
  expect(channel.findAgent('C123').id).toBe('agent-1');
});

test('findAgent returns default agent when no channel is passed', () => {
  const engine = new Engine(new Logger());
  engine.config = mockConfig();
  engine.agents['marvin'] = { id: 'marvin', enabled: true, identity: '', channels: {}, tasks: {}, model: {} as never } as Agent;

  const channel = new MockSlackChannel(engine);
  expect(channel.findAgent().id).toBe('marvin');
});

test('findAgent skips disabled agents', () => {
  const engine = new Engine(new Logger());
  engine.config = mockConfig();
  engine.agents['disabled-agent'] = { id: 'disabled-agent', enabled: false, identity: '', channels: { slack: 'C999' }, tasks: {}, model: {} as never } as Agent;
  engine.agents['active-agent'] = { id: 'active-agent', enabled: true, identity: '', channels: { slack: 'C789' }, tasks: {}, model: {} as never } as Agent;

  const channel = new MockSlackChannel(engine);
  expect(channel.findAgent('C789').id).toBe('active-agent');
});

test('findAgent falls back to the default agent when no channel matches', () => {
  const engine = new Engine(new Logger());
  engine.config = mockConfig();
  engine.agents['marvin'] = { id: 'marvin', enabled: true, identity: '', channels: { slack: 'CDEFAULT' }, tasks: {}, model: {} as never } as Agent;

  const channel = new MockSlackChannel(engine);
  expect(channel.findAgent('CUNKNOWN').id).toBe('marvin');
});

// ============================================================================
// load() / drop() tests
// ============================================================================

test('load() injects mock clients and starts the socket', async () => {
  const { channel } = buildEngine();
  await channel.load();

  expect(channel.mockSok.started).toBe(true);
  expect(channel.mockWeb).toBeDefined();
});

test('drop() disconnects the mock socket', async () => {
  const { channel } = buildEngine();
  await channel.load();
  await channel.drop();

  expect(channel.mockSok.started).toBe(false);
});

test('drop() before load does not throw', async () => {
  const { channel } = buildEngine();
  await channel.drop();
});

// ============================================================================
// checkPrereqs() tests (real implementation + mock web client)
// ============================================================================

test('checkPrereqs passes with valid tokens and working scopes', async () => {
  const { channel } = buildEngine();
  const result = await channel.checkPrereqs('xapp-1-real', 'xoxb-real');
  expect(result.ok).toBe(true);
  expect(result.botId).toBe('U12345678');
});

test('checkPrereqs rejects a non-socket-mode appToken', async () => {
  const { channel } = buildEngine();
  const result = await channel.checkPrereqs('xoxb-wrong-format', 'xoxb-real');
  expect(result.ok).toBe(false);
  expect(result.error).toContain('xapp-');
});

test('checkPrereqs rejects a non-bot botToken', async () => {
  const { channel } = buildEngine();
  const result = await channel.checkPrereqs('xapp-1-real', 'xapp-wrong-format');
  expect(result.ok).toBe(false);
  expect(result.error).toContain('xoxb-');
});

test('checkPrereqs rejects an invalid bot token (auth.test fails)', async () => {
  const { channel } = buildEngine();
  channel.mockWeb.setAuthTestResult({ ok: false, error: 'invalid_auth' });
  const result = await channel.checkPrereqs('xapp-1-real', 'xoxb-invalid');
  expect(result.ok).toBe(false);
  expect(result.error).toContain('invalid_auth');
});

test('checkPrereqs rejects when conversations cannot be listed', async () => {
  const { channel } = buildEngine();
  channel.mockWeb.setConversationListResult({ ok: false, error: 'missing_scope' });
  const result = await channel.checkPrereqs('xapp-1-real', 'xoxb-real');
  expect(result.ok).toBe(false);
  expect(result.error).toContain('missing_scope');
});

test('checkPrereqs rejects an invalid app token (connections.open fails)', async () => {
  const { channel } = buildEngine();
  channel.mockWeb.setConnectionsOpenResult({ ok: false, error: 'invalid_auth' });
  const result = await channel.checkPrereqs('xapp-1-real', 'xoxb-real');
  expect(result.ok).toBe(false);
  expect(result.error).toContain('app token invalid');
  expect(result.error).toContain('invalid_auth');
});

test('checkPrereqs passes when connections.open returns a transient error', async () => {
  const { channel } = buildEngine();
  channel.mockWeb.setConnectionsOpenResult({ ok: false, error: 'internal_error' });
  const result = await channel.checkPrereqs('xapp-1-real', 'xoxb-real');
  expect(result.ok).toBe(true);
  expect(result.botId).toBe('U12345678');
});

// ============================================================================
// sendMessage() tests (real implementation + mock web client)
// ============================================================================

test('sendMessage() posts to Slack and returns a SlackResponse', async () => {
  const { channel } = buildEngine();
  await channel.load();

  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.123', channel: 'C123',
    message: { text: 'reply text', ts: '1700000000.123' },
  } as ChatPostMessageResponse);

  const result = await channel.sendMessage({ role: 'assistant', content: 'hello', channel: 'C123' });

  expect(result.ok).toBe(true);
  expect(result.ts).toBe('1700000000.123');
  expect(result.channel).toBe('C123');
});

test('sendMessage() includes thread_ts for threaded messages', async () => {
  const { channel } = buildEngine();
  await channel.load();

  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.456', channel: 'C123',
    message: { text: 'thread reply', ts: '1700000000.456' },
  } as ChatPostMessageResponse);

  const result = await channel.sendMessage({
    role: 'assistant', content: 'thread reply', channel: 'C123', thread: '1700000000.999',
  });

  expect(channel.mockWeb.postMessageCalls[0]!.channel).toBe('C123');
  expect(channel.mockWeb.postMessageCalls[0]!.thread_ts).toBe('1700000000.999');
  expect(result.ok).toBe(true);
});

test('sendMessage() reports failure on channel mismatch', async () => {
  const { channel } = buildEngine();
  await channel.load();

  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.789', channel: 'C456',
    message: { text: 'sent elsewhere' },
  } as ChatPostMessageResponse);

  const result = await channel.sendMessage({
    role: 'assistant', content: 'sent elsewhere', channel: 'C123',
  });

  expect(result.ok).toBe(false);
});

test('sendMessage() throws when web client is not attached', async () => {
  const { channel } = buildEngine();
  // do not call load() - web is undefined

  let threw = false;
  try {
    await channel.sendMessage({ role: 'assistant', content: 'hello' });
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
});

test('sendMessage() reports actionable hints for known Slack errors', async () => {
  const { channel } = buildEngine();
  await channel.load();

  channel.mockWeb.setPostMessageResult({
    ok: false, error: 'missing_scope', message: {},
  } as ChatPostMessageResponse);

  const result = await channel.sendMessage({ role: 'assistant', content: 'hello', channel: 'C123' });

  expect(result.ok).toBe(false);
  expect(result.error).toBe('missing_scope');
  expect(result.message).toContain('chat:write');
});

test('listGroups() maps Slack channels to ids', async () => {
  const { channel } = buildEngine();
  await channel.load();

  channel.mockWeb.setConversationListResult({
    ok: true,
    channels: [{ id: 'C1', name: 'general' }, { id: 'C2', name: 'random' }],
  });

  const groups = await channel.listGroups();
  expect(groups).toEqual({ C1: 'general', C2: 'random' });
});

// ============================================================================
// End-to-end ingress: Slack event → Marvin AI loop → Slack reply
// ============================================================================

test('E2E: app_mention → LLM → Slack reply', async () => {
  const { model, channel } = buildEngine({ replies: [reply('Hello there!')] });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.001', channel: 'C123',
    message: { text: 'Hello there!', ts: '1700000000.001' },
  } as ChatPostMessageResponse);

  let acked = false;
  await channel.mockSok.emit('app_mention', {
    event: mentionEvent().event,
    body: { callback_id: 'app_mention' },
    ack: async () => { acked = true; },
  });

  expect(acked).toBe(true);
  expect(model.callCount).toBe(1);
  expect(channel.mockWeb.postMessageCalls.length).toBe(1);
  const posted = channel.mockWeb.postMessageCalls[0]!;
  expect(posted.channel).toBe('C123');
  expect(posted.thread_ts).toBe('1700000000.001');
  expect(posted.text).toBe('Hello there!');
});

test('E2E: app_mention runs tools then posts the final answer', async () => {
  const { model, channel, engine } = buildEngine({
    replies: [
      reply('', { stop: false, tools: [{ id: 't1', name: 'get_date', arguments: { timestamp: 0 } }] }),
      reply('The date is 1/1/1970'),
    ],
  });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.002', channel: 'C123',
    message: { text: 'The date is 1/1/1970', ts: '1700000000.002' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('app_mention', mentionEvent({ text: '<@U12345678> what is today?' }));

  expect(model.callCount).toBe(2);
  expect(channel.mockWeb.postMessageCalls[0]!.text).toBe('The date is 1/1/1970');

  // tool result was persisted to the thread's chat history
  const chat = engine.findChat('slack-C123-1700000000.001');
  expect(chat).not.toBeNull();
  expect(chat!.messages.filter((m: Message) => m.role === 'tool').length).toBeGreaterThan(0);
});

test('E2E: message (im) → LLM → Slack DM reply', async () => {
  const { model, channel } = buildEngine({ replies: [reply('Direct message reply')] });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.003', channel: 'D123',
    message: { text: 'Direct message reply', ts: '1700000000.003' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('message', {
    event: { text: 'hi marvin', channel: 'D123', channel_type: 'im', ts: '1700000000.003', event_ts: '1700000000.003' },
    body: {},
    ack: async () => {},
  });

  expect(model.callCount).toBe(1);
  expect(channel.mockWeb.postMessageCalls[0]!.channel).toBe('D123');
  expect(channel.mockWeb.postMessageCalls[0]!.text).toBe('Direct message reply');
});

test('E2E: non-im message events are acknowledged and ignored', async () => {
  const { model, channel } = buildEngine({ replies: [reply('should not post')] });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.010', channel: 'C123',
    message: { text: 'ignored', ts: '1700000000.010' },
  } as ChatPostMessageResponse);

  let acked = false;
  await channel.mockSok.emit('message', {
    event: { text: 'hi', channel: 'C123', channel_type: 'channel', ts: '1700000000.010' },
    body: {},
    ack: async () => { acked = true; },
  });

  expect(acked).toBe(true);
  expect(model.callCount).toBe(0);
  expect(channel.mockWeb.postMessageCalls.length).toBe(0);
});

test('E2E: the bot ignores its own DMs (no infinite loop)', async () => {
  const { model, channel } = buildEngine({ replies: [reply('should not post')] });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.011', channel: 'D123',
    message: { text: 'ignored', ts: '1700000000.011' },
  } as ChatPostMessageResponse);

  let acked = false;
  await channel.mockSok.emit('message', {
    event: { text: 'reply text', channel: 'D123', channel_type: 'im', subtype: 'bot_message', bot_id: 'B123', ts: '1700000000.011' },
    body: {},
    ack: async () => { acked = true; },
  });

  expect(acked).toBe(true);
  expect(model.callCount).toBe(0);
  expect(channel.mockWeb.postMessageCalls.length).toBe(0);
});

test('E2E: empty DM posts the placeholder reply', async () => {
  const { model, channel } = buildEngine({ replies: [reply('irrelevant')] });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.006', channel: 'D123',
    message: { text: '(no text content)', ts: '1700000000.006' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('message', {
    event: { text: '', channel: 'D123', channel_type: 'im', ts: '1700000000.013', event_ts: '1700000000.013' },
    body: {},
    ack: async () => {},
  });

  expect(model.callCount).toBe(0);
  expect(channel.mockWeb.postMessageCalls[0]!.text).toBe('(no text content)');
});;

test('E2E: mention with no text posts the placeholder reply', async () => {
  const { model, channel } = buildEngine({ replies: [reply('irrelevant')] });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.004', channel: 'C123',
    message: { text: '(no text content)', ts: '1700000000.004' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('app_mention', mentionEvent({ text: '<@U12345678>' }));

  expect(model.callCount).toBe(0);
  expect(channel.mockWeb.postMessageCalls[0]!.text).toBe('(no text content)');
});

test('E2E: LLM failure posts the (no response from the AI) reply', async () => {
  const { channel } = buildEngine({ fail: true });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.005', channel: 'C123',
    message: { text: '(no response from the AI)', ts: '1700000000.005' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('app_mention', mentionEvent());

  expect(channel.mockWeb.postMessageCalls[0]!.text).toBe('(no response from the AI)');
});

test('E2E: JSON LLM output is extracted to the string sent to Slack', async () => {
  const { channel } = buildEngine({ replies: [reply('{"output": "The answer is 42"}')] });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.006', channel: 'C123',
    message: { text: 'irrelevant', ts: '1700000000.006' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('app_mention', mentionEvent());

  expect(channel.mockWeb.postMessageCalls[0]!.text).toBe('The answer is 42');
});

test('E2E: non-JSON LLM output is posted unchanged', async () => {
  const { channel } = buildEngine({ replies: [reply('plain text reply')] });
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.007', channel: 'C123',
    message: { text: 'irrelevant', ts: '1700000000.007' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('app_mention', mentionEvent());

  expect(channel.mockWeb.postMessageCalls[0]!.text).toBe('plain text reply');
});

// ============================================================================
// onSlashCommand + connection state handler tests
// ============================================================================

test('onSlashCommand acks then posts the help output to the channel', async () => {
  const { channel } = buildEngine();
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.020', channel: 'C123',
    message: { text: 'help text', ts: '1700000000.020' },
  } as ChatPostMessageResponse);

  let ackText = '';
  await channel.mockSok.emit('slash_commands', {
    event: { channel_id: 'C123' },
    body: { command: '/marvin', text: 'help', channel_id: 'C123' },
    ack: async (response: any) => { ackText = response?.text || ''; },
  });

  expect(ackText).toContain('running /marvin help');
  expect(channel.mockWeb.postMessageCalls.length).toBe(1);
  const posted = channel.mockWeb.postMessageCalls[0]!;
  expect(posted.channel).toBe('C123');
  expect(posted.text).toContain('usage: marvin [command]');
  expect(posted.text).toContain('version');
});

test('onSlashCommand forwards command args and posts the result', async () => {
  const { channel } = buildEngine();
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.021', channel: 'C123',
    message: { text: 'skills list', ts: '1700000000.021' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('slash_commands', {
    event: { channel_id: 'C123' },
    body: { command: '/marvin', text: 'skills list', channel_id: 'C123' },
    ack: async () => {},
  });

  const posted = channel.mockWeb.postMessageCalls[0]!;
  // the "list" arg was forwarded to SkillsCommand (without it, help would run)
  expect(posted.text).toContain('default skills:');
  expect(posted.text).toContain('custom skills:');
});

test('onSlashCommand replies with an error for an unknown command', async () => {
  const { channel } = buildEngine();
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.022', channel: 'C123',
    message: { text: 'error', ts: '1700000000.022' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('slash_commands', {
    event: { channel_id: 'C123' },
    body: { command: '/marvin', text: 'foobar', channel_id: 'C123' },
    ack: async () => {},
  });

  const posted = channel.mockWeb.postMessageCalls[0]!;
  expect(posted.text).toContain('unknown command: foobar');
  expect(posted.text).toContain('available commands');
});

test('onSlashCommand does not expose blocked commands', async () => {
  const { channel } = buildEngine();
  await channel.load();
  channel.mockWeb.setPostMessageResult({
    ok: true, ts: '1700000000.023', channel: 'C123',
    message: { text: 'error', ts: '1700000000.023' },
  } as ChatPostMessageResponse);

  await channel.mockSok.emit('slash_commands', {
    event: { channel_id: 'C123' },
    body: { command: '/marvin', text: 'serve', channel_id: 'C123' },
    ack: async () => {},
  });

  const posted = channel.mockWeb.postMessageCalls[0]!;
  expect(posted.text).toContain('serve cannot be run from slack');
  // serve must not be listed among the available commands
  const list = (posted.text || '').split('available commands: ')[1] || '';
  expect(list).not.toContain('serve');

  await channel.mockSok.emit('slash_commands', {
    event: { channel_id: 'C123' },
    body: { command: '/marvin', text: 'disable', channel_id: 'C123' },
    ack: async () => {},
  });

  const second = channel.mockWeb.postMessageCalls[1]!;
  expect(second.text).toContain('disable cannot be run from slack');
});

test('onError logs error to its logger', async () => {
  const { logger, lines } = captureLogger();
  const channel = buildChannel(logger);
  await channel.load();

  await channel.onError(new Error('test error'));

  expect(lines.length).toBe(1);
  expect(lines[0]).toContain('[SlackChannel.onError]');
});

test('onConnected logs connected message', async () => {
  const { logger, lines } = captureLogger();
  const channel = buildChannel(logger);
  await channel.load();

  await channel.onConnected();

  expect(lines[0]).toContain('connected');
});

test('onReconnecting logs warning with attempt number', async () => {
  const { logger, lines } = captureLogger();
  const channel = buildChannel(logger);
  await channel.load();

  await channel.onReconnecting(3);

  expect(lines[0]).toContain('reconnecting');
  expect(lines[0]).toContain('3');
});

test('onDisconnected logs warning with error', async () => {
  const { logger, lines } = captureLogger();
  const channel = buildChannel(logger);
  await channel.load();

  await channel.onDisconnected(new Error('network error'));

  expect(lines[0]).toContain('disconnected');
});
