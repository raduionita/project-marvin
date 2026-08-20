import { test, expect } from 'bun:test';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from './engine.js';
import { Logger } from './logger.js';
import { Config, Message, Chat, Reply, System, Model } from './types.js';
import { Agent } from './agent.js';
import SlackChannel from './channels/slack.js';
import { type ISocketModeClient, type IWebClient } from './channels/slack.js';
import WebSearchTool from './tools/web_search.js';
import CallIntegrationTool from './tools/call_integration.js';
import FindIntegrationTool from './tools/find_integration.js';
import WordpressIntegration from './integrations/wordpress.js';

// ============================================================================
// End-to-end flow: Slack -> Marvin AI loop -> web_search -> wordpress -> Slack
// The real Slack handlers, the real engine AI loop, the real web_search tool
// (against a fake browser page), the real call_integration tool and the real
// wordpress integration (against a mocked fetch) all run. Only the LLM itself
// (FlowModel) and the Slack SDK clients are mocked.
// ============================================================================

// --- Slack SDK mocks (same shape as the real clients) ---

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

class MockWebClient implements IWebClient {
  public postMessageCalls: { channel?: string; thread_ts?: string; text?: string; blocks?: any[] }[] = [];
  public postMessageResult: any = { ok: true, ts: '1700000000.001', channel: 'C123', message: { text: 'ok', ts: '1700000000.001' } };
  public conversationListResult: any = { ok: true, channels: [] };
  public authTestResult: any = { ok: true, user_id: 'U12345678' };
  public connectionsOpenResult: any = { ok: true, url: 'wss://example.com/conn' };

  public chat = {
    postMessage: async (args: any): Promise<any> => {
      this.postMessageCalls.push(args);
      return this.postMessageResult;
    },
  };

  public conversations = {
    list: async (): Promise<any> => this.conversationListResult,
  };

  public auth = {
    test: async (): Promise<any> => this.authTestResult,
  };

  public apps = {
    connections: {
      open: async (): Promise<any> => this.connectionsOpenResult,
    },
  };
}

// real handlers (onMention, sendMessage, ...) run, only the SDK clients are swapped
class MockSlackChannel extends SlackChannel {
  public mockSok: MockSocketModeClient;
  public mockWeb: MockWebClient;

  constructor(engine: Engine) {
    super(engine);
    this.mockSok = new MockSocketModeClient();
    this.mockWeb = new MockWebClient();
  }

  async load() {
    this.socketClient = this.mockSok;
    this.webClient = this.mockWeb;
    this.botId = this.mockWeb.authTestResult?.user_id || '';
    this.socketClient.on('app_mention', this.onMention.bind(this) as (...args: any[]) => any);
    await this.socketClient.start();
  }
}

// --- fake browser system for the real web_search tool ---

const SEARCH_START_TAG = "DDG.pageLayout.load('d',";
const SEARCH_END_TAG = ");DDG.duckbar.loadModule";

class FakeBrowserSystem extends System {
  public pagesOpened = 0;

  async load() {}
  async drop() {}

  async newPage(onRequest?: (req: any) => void) {
    this.pagesOpened++;
    let closed = false;
    return {
      setDefaultNavigationTimeout: () => {},
      goto: async () => {},
      waitForResponse: async () => ({
        text: async () =>
          `${SEARCH_START_TAG}[{"t":"<b>Coffee</b> history","a":"The history of coffee dates back centuries","c":"https://en.wikipedia.org/wiki/Coffee"}]${SEARCH_END_TAG}`,
      }),
      close: async () => { closed = true; },
      isClosed: () => closed,
      _onRequest: onRequest,
    };
  }
}

// --- fake LLM: drives the tool-call loop like a real model would ---

class FlowModel extends Model {
  public callCount = 0;

  async execChat(chat: Chat): Promise<Reply> {
    this.callCount++;
    if (this.callCount === 1) {
      // research step
      return {
        id: 'r1', stop: false, finish: 'tool_calls',
        message: { role: 'assistant', content: '', tools: [{ id: 'call_1', name: 'web_search', arguments: { query: 'history of coffee' } }] },
        usage: { completion: 5, prompt: 10 },
      } as Reply;
    }
    if (this.callCount === 2) {
      // learn the integration schema before publishing (find_integration)
      return {
        id: 'r2', stop: false, finish: 'tool_calls',
        message: { role: 'assistant', content: '', tools: [{ id: 'call_2', name: 'find_integration', arguments: { integration: 'gloobeam', action: 'create_post' } }] },
        usage: { completion: 5, prompt: 10 },
      } as Reply;
    }
    if (this.callCount === 3) {
      // publish step (schema known)
      return {
        id: 'r3', stop: false, finish: 'tool_calls',
        message: {
          role: 'assistant', content: '',
          tools: [{
            id: 'call_3', name: 'call_integration',
            arguments: { integration: 'gloobeam', action: 'create_post', params: { title: 'The History of Coffee', content: 'A short summary...', publish: true } },
          }],
        },
        usage: { completion: 5, prompt: 10 },
      } as Reply;
    }
    // final answer
    return {
      id: 'r4', stop: true, finish: 'stop',
      message: { role: 'assistant', content: '{"output": "Published to Wordpress: https://wp.example.com/?p=42"}' },
      usage: { completion: 5, prompt: 10 },
    } as Reply;
  }
}

// --- fixtures ---

function mockConfig(): Config {
  return {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', apiToken: 'changeme' },
    channels: { slack: { enabled: true, appToken: 'xapp-test', botToken: 'xbot-test' } },
    integrations: { gloobeam: { enabled: true, type: 'wordpress', endpoint: 'https://wp.example.com' } },
    models: {},
    agents: { marvin: { enabled: true, channels: { slack: 'C123' } } },
  };
}

function mentionEvent(overrides: { [key: string]: any } = {}): { event: any; body: any; ack: () => Promise<void> } {
  return {
    event: {
      type: 'app_mention',
      text: '<@U12345678> research the history of coffee and post a summary to wordpress',
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

function buildFlow(): { engine: Engine; model: FlowModel; channel: MockSlackChannel; browser: FakeBrowserSystem; wpCalls: { url: string; init: any }[] } {
  const engine = new Engine(new Logger());
  engine.isDry = false;
  engine.state = 'exec';
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-flow-'));
  engine.config = mockConfig();

  const model = new FlowModel(engine, new Logger(), {});
  engine.models['flow.model'] = model;

  engine.agents['marvin'] = new Agent(engine, new Logger(), {
    id: 'marvin',
    enabled: true,
    identity: 'You are Marvin, a helpful assistant.',
    channels: { slack: 'C123' },
    model: model,
  });

  // real tools
  engine.tools['web_search'] = new WebSearchTool(engine, new Logger());
  engine.tools['call_integration'] = new CallIntegrationTool(engine, new Logger());
  engine.tools['find_integration'] = new FindIntegrationTool(engine, new Logger());

  // fake browser so the real web_search tool runs end-to-end
  const browser = new FakeBrowserSystem(engine, new Logger());
  engine.systems['browser'] = browser;

  // real wordpress integration, with fetch mocked
  const wpCalls: { url: string; init: any }[] = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    wpCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 42, title: 'The History of Coffee', link: 'https://wp.example.com/?p=42' }),
      json: async () => ({ id: 42, title: 'The History of Coffee', link: 'https://wp.example.com/?p=42' }),
    } as Response;
  }) as typeof fetch;

  engine.integrations['gloobeam'] = new WordpressIntegration(engine, new Logger(), {
    type: 'wordpress',
    endpoint: 'https://wp.example.com',
    user: 'admin',
    appPassword: 'abcd efgh',
  });

  const channel = new MockSlackChannel(engine);
  return { engine, model, channel, browser, wpCalls };
}

test('full flow: slack research request reaches wordpress and replies in the thread', async () => {
  const { channel, model, browser, wpCalls } = buildFlow();
  await channel.load();

  await channel.mockSok.emit('app_mention', mentionEvent());

  // the AI loop ran: search -> schema lookup -> publish -> final reply
  expect(model.callCount).toBe(4);

  // web_search really executed (the real tool against the fake browser page)
  expect(browser.pagesOpened).toBe(1);

  // find_integration returned the wordpress schema (no extra network call)
  expect(wpCalls.length).toBe(1);
  expect(wpCalls[0]!.url).toBe('https://wp.example.com/wp-json/wp/v2/posts');
  expect(wpCalls[0]!.init.method).toBe('POST');
  const body = JSON.parse(wpCalls[0]!.init.body);
  expect(body.title).toBe('The History of Coffee');
  expect(body.status).toBe('publish');
  expect(body.content).toContain('summary');

  // the final Slack reply is posted in the original thread
  expect(channel.mockWeb.postMessageCalls.length).toBe(1);
  expect(channel.mockWeb.postMessageCalls[0]!.blocks![0]!.text).toBe('Published to Wordpress: https://wp.example.com/?p=42');
  expect(channel.mockWeb.postMessageCalls[0]!.channel).toBe('C123');
  expect(channel.mockWeb.postMessageCalls[0]!.thread_ts).toBe('1700000000.001');
});

test('full flow: the tool results are kept in the chat cache for context', async () => {
  const { engine, channel } = buildFlow();
  await channel.load();

  await channel.mockSok.emit('app_mention', mentionEvent());

  const chat = engine.agents['marvin']!.loadChat('slack-C123-1700000000.001', 'json', {});
  expect(chat).not.toBeNull();

  const toolMessages = chat!.messages.filter(m => m.role === 'tool');
  // one web_search result + one find_integration schema + one call_integration (wordpress) result
  expect(toolMessages.length).toBe(3);
  expect(toolMessages[0]!.content).toContain('Coffee');
  expect(toolMessages[1]!.content).toContain('create_post');
  expect(toolMessages[2]!.content).toContain('42');
});

test('full flow: dry mode skips the search, the publish and the post', async () => {
  const { channel, model, browser, wpCalls } = buildFlow();
  channel.engine.isDry = true;
  await channel.load();

  await channel.mockSok.emit('app_mention', mentionEvent());

  expect(model.callCount).toBe(0);
  expect(browser.pagesOpened).toBe(0);
  expect(wpCalls.length).toBe(0);
  expect(channel.mockWeb.postMessageCalls.length).toBe(0);
});
