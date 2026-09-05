import { SocketModeClient, LogLevel, SMWebsocketError } from '@slack/socket-mode';
import { WebClient, ChatPostMessageArguments, ChatPostMessageResponse, ViewsPublishResponse,ViewsOpenArguments, ViewsOpenResponse, ViewsUpdateArguments, ViewsPublishArguments} from '@slack/web-api';
import { Channel, Command, Message, ChannelMeta } from '../types.js';
import { Agent } from '../agent.js';
import type Engine from '../engine.js';
import { listCommands } from '../commands/index.js';
import { setDefaultOutput } from '../logger.js';
import * as constants from '../constants.js';
import logger from '../logger.js';
import { read } from 'node:fs';
import { readError } from '../helpers/error.js';

// commands that mutate/restart the daemon itself (or serve it) and are
// therefore not callable from Slack
export const SLASH_BLOCKED_COMMANDS = ['serve', 'reload', 'disable', 'enable', 'install', 'update'];

export type HandlerParams = { event: { [key: string]: any }, body: Record<string, any>, ack: (response?: Record<string, unknown>) => Promise<void> };

export type SlackResponse = { ts: string; ok: boolean; error: string | undefined; message?: string, channel?: string };

export type SlackConfig = { enabled: boolean, appToken: string, botToken: string };

export interface ISocketModeClient {
  start: () => Promise<any>;
  disconnect: () => Promise<void>;
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, handler: (...args: any[]) => any) => void;
}

export interface IWebClient {
  chat: {
    postMessage: (args: ChatPostMessageArguments) => Promise<ChatPostMessageResponse>;
  };
  views?: {
    publish: (args: ViewsPublishArguments) => Promise<ViewsPublishResponse>;
    update: (args: ViewsUpdateArguments) => Promise<ViewsPublishResponse>;
    open: (args: ViewsOpenArguments) => Promise<ViewsOpenResponse>;
  };
  conversations: {
    list: (args?: any) => Promise<any>;
  };
  auth: {
    test: (args?: any) => Promise<any>;
  };
}

export default class SlackChannel extends Channel {
  public meta: ChannelMeta = {
    name: 'slack',
    arguments: {
      appToken: 'xapp-1-yout-app-token-here',
      botToken: 'xbot-1-your-bot-token-here',
    },
  }

  // slack uses the shared default logger from ./logger.js; per-command capture is
// built inline in `runCommand` (a fresh `new Logger({...})` with its own sink).
  constructor(engine: Engine) {
    super(engine);
  }

  protected socketClient!: ISocketModeClient;
  protected webClient!: IWebClient;

  // the bot's user id, used to strip only the bot's own mention from messages
  protected botId: string = '';

  async load() {
    try {
      logger.debug('[SlackChannel.load]');

      const config = this.engine.config.channels.slack as SlackConfig | undefined;
      if (!config) {
        logger.error('[SlackChannel.load]', 'no settings found, skipping');
        return;
      }

      const appToken = (config?.appToken || process.env.SLACK_APP_TOKEN);
      if (!appToken || !appToken.startsWith('xapp-')) {
        logger.error('[SlackChannel.load]', 'no appToken found, skipping');
        return;
      }

      const botToken = (config?.botToken || process.env.SLACK_BOT_TOKEN);
      if (!botToken || !botToken.startsWith('xoxb-')) {
        logger.error('[SlackChannel.load]', 'no botToken found, skipping');
        return;
      }

      // create web client
      this.webClient = this.newWebClient(botToken);
      // verify the bot token is valid, and capture the bot's user id
      const auth = await this.webClient.auth.test();
      if (!auth.ok || !auth.user_id) {
        logger.error('[SlackChannel.load]', 'bot token invalid:', auth.error);
        return;
      }
    
      // create socket mode client; start() validates the app token via
      // apps.connections.open (Authorization header only) and rejects on
      // unrecoverable auth errors (invalid_auth, ...)
      this.socketClient = this.newSocketClient(appToken);

      this.botId = auth.user_id;

      this.socketClient.on('error', this.onError.bind(this));
      this.socketClient.on('connecting', this.onConnecting.bind(this));
      this.socketClient.on('connected', this.onConnected.bind(this));
      this.socketClient.on('disconnected', this.onDisconnected.bind(this));
      this.socketClient.on('reconnecting', this.onReconnecting.bind(this));

      // route Slack events to Marvin's AI loop
      this.socketClient.on('app_mention', this.onMessage.bind(this));
      // the SocketMode client emits DM messages as "message" with channel_type "im"
      this.socketClient.on('message', this.onSocketMessage.bind(this));
      this.socketClient.on('slash_commands', this.onSlashCommand.bind(this));

      await this.socketClient.start();

      logger.debug('[SlackChannel.load]','channel slack started');
    } catch (err) {
      logger.warn('[SlackChannel.load]', 'error:', (err as Error).message);
    }
  }

  async drop() {
    logger.debug('[SlackChannel.drop]');
    if (this.socketClient) {
      await this.socketClient.disconnect();
      logger.debug('[SlackChannel.drop]','channel slack dropped');
    }
  }

  async info() : Promise<{ groups: { [key: string]: string } }> {
    logger.debug('[SlackChannel.info]');
    const response = await this.webClient.conversations.list({ 
      exclude_archived: true, 
      limit: 100,
    });
    if (!response || !response.ok || !response.channels) {
      logger.error('[SlackChannel.info]', 'error:', response.error);
      return {
        groups: {},
      };
    }
    // id=>name map
    const channels: {[key:string]:string} = {};
    for (const channel of response.channels) {
      const id = channel.id || channel.user || channel.name;
      if (!id) continue;
      channels[id] = channel.name || id;
    }

    return {
      'groups': channels,
    }
  }

  // send a message to Slack, optionally as a thread reply
  public async sendMessage(message: Message) : Promise<SlackResponse> {
    try {
      logger.info('[SlackChannel.sendMessage]', `group=${message.group || '(none)'} thread=${message.thread || '(none)'} agent=${message.agent || '(none)'}`);

      // need web client
      if (!this.webClient) {
        logger.error('[SlackChannel.sendMessage]', 'not attached, skipping submit');
        return { ts: '', ok: false, error: 'web client not attached', message: '(slack not attached)' };
      }

      if (!message.group) {
        logger.warn('[SlackChannel.sendMessage]', 'no channel, skipping submit');
        return { ts: '', ok: false, error: 'no channel provided', message: '(no channel)' };
      }

      // always send a markdown block: the LLM output is markdown, Slack renders
      // it (headers, bold, links, ...) via the legacy "markdown" block type
      const response = await this.webClient.chat.postMessage({
        channel: message.group,
        thread_ts: message.thread || undefined,
        blocks: [{ 
          type: 'markdown', 
          text: message.content 
        }, {
          type: "divider"
        },{
          type: "markdown",
          text: '**Agent**: `'   + (message.agent  || '(none)') + '`\n' +
                '**Model**: `'   + (message.model  || '(none)') + '`\n' +
                '**Channel**: `' + (message.group  || '(none)') + '`\n' +
                '**Thread**: `'  + (message.thread || '(none)') + '`\n' + 
                '**Usage**: `'   + (message.usage  || '(none)') + '`\n'
        },
      ]});

      // check if response is ok
      if (!response.ok) {
        const hint = this.errorToHint(response.error);
        logger.error('[SlackChannel.sendMessage]', 'response NOT ok:', response.error, hint);
        return { ts: '', ok: false, error: response.error, message: hint || '(slack response not ok)' };
      }

      // we should know if there is a mismatch between the channel in the message and the response
      if (response.channel !== message.group) {
        logger.warn('[SlackChannel.sendMessage]', `channel mismatch: expected ${message.group}, got ${response.channel}`);
        response.error = '(slack channel mismatch)';
      }

      return {
        ts: response.message?.ts || '',
        ok: true,
        error: response.error || '',
        message: response.message?.text || '',
        channel: response.channel || message.group || '',
      }
    } catch (err) {
      logger.error('[SlackChannel.sendMessage]', 'failed to send message:', readError(err));
      return { ts: '', ok: false, error: (err as Error).message, message: '(slack sendMessage failed)' };
    }
  }

  // send an "status" update (not the final answer) message to Slaxk 
  private async sendUpdates(update: string, group?: string, thread?: string, chatId?: string, done: boolean = false) : Promise<boolean> {
    try {
      // need web client
      if (!this.webClient) {
        logger.error('[SlackChannel.sendUpdate]', 'not attached, skipping submit');
        return false;
      }

      if (!group) {
        logger.warn('[SlackChannel.sendUpdate]', 'no channel, skipping submit');
        return false;
      }

      // todo: views
      // this.webClient.v

      const response = await this.webClient.chat.postMessage({
        channel: group,
        thread_ts: thread || undefined,
        blocks: [
          {
            "type": "markdown",
            "text": update,
          }
        ]
      });

      if (!response.ok) {
        const hint = this.errorToHint(response.error);
        logger.error('[SlackChannel.sendUpdate]', 'response NOT ok:', response.error, hint);
        return false;
      }

      return true;
    } catch (err) {
      logger.error('[SlackChannel.sendUpdate]', 'failed to send update:', readError(err));
      return false;
    }
  }

  // socket mode client factory
  protected newSocketClient(appToken: string): ISocketModeClient {
    return new SocketModeClient({
      appToken,
      logLevel: LogLevel.ERROR,
      autoReconnectEnabled: true,
      clientOptions: { retryConfig: { retries: 5 } }
    });
  }

  // web client factory
  protected newWebClient(botToken: string): IWebClient {
    return new WebClient(botToken, {
      logLevel: LogLevel.ERROR,
      retryConfig: { retries: 5 }
    });
  }

  // handles both app_mention events and DM messages (via onSocketMessage)
  protected async onMessage({ event, body, ack }: HandlerParams) {
    const thread = event.thread_ts || event.ts || event.event_ts;
    try {
      logger.info('[SlackChannel.onMessage]', `group=${event.channel}, thread=${thread}`); // , 'body=', JSON.stringify(body), 'event=', JSON.stringify(event));

      // extract the actual message text (strip @marvin mention)
      const text = this.cleanText(event.text || '');
      if (!text) {
        logger.warn('[SlackChannel.onMessage]', 'no text content');
        return await ack({ text: '(no text content)' });
      }

      // acknowledge the event
      await ack();

      // find an agent that has slack configured
      const agent = this.findAgent(event.channel);
      const agentId = agent.id;
      const modelId = agent.model?.model;
      const chatId = `slack-${event.channel}-${thread}`;

      logger.debug('[SlackChannel.onMessage]', `processing agent=${agentId} "${text.slice(0, 64)}"`);

      const updates: string[] = [];
      const sendUpdates = (update:string) => this.sendUpdates(update, event.channel, thread, chatId);

      // ! process through Marvin's AI loop (executes model calls + tool execution)
      const result = await agent.sendChat(chatId, text, sendUpdates);
      if (result.error) {
        logger.error('[SlackChannel.onMessage]', `AI loop failed for agent ${agentId}:`, result.error);
        result.content = `(AI loop error: ${result.error})`;
      }

      // update the task card
      this.sendUpdates('done', event.channel, thread, chatId);

      // ! reply to user // send the result to the user
      const res = await this.sendMessage({ role: 'assistant', content: result.content || '(no response)', group: event.channel, thread, agent: agentId, model: modelId, usage: result.usage });
      if (!res.ok) {
        logger.warn('[SlackChannel.onMessage]', 'failed to post reply:', res.error, res.message);
      }
    } catch (error) {
      logger.error('[SlackChannel.onMessage]', error);
    }
  }

  // execute `/marvin <command> [args...]` from Slack: any command in
  // src/commands/ (except serve & daemon-mutating ones) is dispatched
  // dynamically, its console output is captured and posted back to the channel
  protected async onSlashCommand({ event, body, ack }: HandlerParams) {
    try {
      const text = (body.text || '').trim();
      const parts = text ? text.split(/\s+/) : [];
      const name = parts[0] || 'help';
      const args = parts.slice(1);
      const channelId = body.channel_id || event.channel_id;

      const cmds = listCommands(this.engine).filter(c => !SLASH_BLOCKED_COMMANDS.includes(c));

      // acknowledge immediately (Slack requires ack within ~3s), the result is posted afterwards
      await ack();

      let output = '';
      if (!cmds.includes(name)) {
        const hint = SLASH_BLOCKED_COMMANDS.includes(name) ? `${name} cannot be run from slack` : `unknown command: ${name}`;
        logger.info('[SlackChannel.onSlashCommand]', hint, '(available:', cmds.join(', '), ')');
        output = `${hint}\navailable commands: ${cmds.join(', ')}`;
      } else {
        output = await this.runCommand(name, args);
        logger.info('[SlackChannel.onSlashCommand]', `command ${name} output:\n${output}`);
      }

      const res = await this.sendMessage({ role: 'assistant', content: output || '(no output)', group: channelId });
      if (!res.ok) {
        logger.warn('[SlackChannel.onSlashCommand]', 'failed to post reply:', res.error, res.message);
      }
    } catch (error) {
      logger.error('[SlackChannel.onSlashCommand]', error);
    }
  }

  // route SocketMode "message" events: DM messages reach onMessage,
  // everything else (bot's own messages, channel messages) is acknowledged & ignored
  protected async onSocketMessage({ event, body, ack }: HandlerParams) {
    try {
      const isBotOwn = event.subtype === 'bot_message' || !!event.bot_id;
      if (event.channel_type !== 'im' || isBotOwn) {
        return await ack({ text: '(ignored)' });
      }
      await this.onMessage({ event, body, ack });
    } catch (error) {
      logger.error('[SlackChannel.onSocketMessage]', error);
    }
  }

  protected async onError(error: Error) {
    // routine transport disconnects (abnormal close 1006, empty message) are
    // expected and handled by the client's auto-reconnect; only surface real errors
    const msg = (error as any)?.original?.message || error.message;
    const code = (error as any)?.code || 0;
    if (!msg) {
      logger.warn('[SlackChannel.onError]', 'websocket disconnected (auto-reconnecting)');
      return;
    }
    logger.error('[SlackChannel.onError]', `code=${code} message=${msg}`);
  }

  protected async onConnecting() {
    logger.debug('[SlackChannel.onConnecting]', 'connecting?');
  }

  protected async onReconnecting() {
    logger.debug('[SlackChannel.onReconnecting]', 'reconnecting?');
  }

  protected async onConnected() {
    logger.info('connected!');
  }

  protected async onDisconnected(error: Error) {
    logger.warn('[SlackChannel.onDisconnected]', 'disconnected!', readError(error));
  }

// dynamically load a command class (mirrors marvin.ts execCommand), execute it
// capturing its logger output, then drop it. swaps the shared default output
// for the duration of the command so nothing leaks to the global console
  protected async runCommand(name: string, args: string[]): Promise<string> {
    const Module = await import(`../commands/${name}.ts`);
    const Class = Module.default;
    if (!Class || !(Class.prototype instanceof Command)) {
      throw new Error(`${name} does not export a Command class`);
    }

    const lines: string[] = [];
    // skip debug chatter, keep everything that would reach the user
    const restore = setDefaultOutput((level, line) => {
      if (level === 'debug') return;
      lines.push(line.map(String).join(' '));
    });

    const command = new Class(this.engine, args);
    try {
      await command.exec();
    } finally {
      await command.drop();
      restore();
    }

    return lines.join('\n');
  }

  // extract the actual text from a Slack event, stripping ONLY the bot's own mention
  protected cleanText(text: string): string {
    // strip only the bot's own mention (e.g. <@U12345678>), keeping other users' mentions
    if (this.botId) {
      text = text.replace(new RegExp(`<@${this.botId}>`, 'g'), ' ');
    }

    // clean up extra whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  // find agent using event.channel or fallback to default "marvin"
  protected findAgent(channel?: string): Agent {
    logger.debug('[SlackChannel.findAgent]', channel ? `channel=${channel}` : 'marvin');

    // diretly use marvin/orchestrator agent
    if (!channel) {
      return this.engine.agents[this.engine.config.settings.name]!
    }

    // find ir first enabled agent that has slack configured
    for (const agent of Object.values(this.engine.agents)) {
      if (!agent.enabled) continue;

      // find the agent that has the slack+group configured
      if (agent.channels['slack'] === channel) {
        return agent;
      }
    }

    // marvin agent MUST exist
    return this.engine.agents[this.engine.config.settings.name]!;
  }

  // translate common Slack API errors into actionable hints
  protected errorToHint(error: string | undefined): string {
    switch (error) {
      case 'not_authorized':
      case 'missing_scope':
        return '(hint: the bot needs the "chat:write" scope)';
      case 'channel_not_found':
        return '(hint: make sure the bot has been added/invited to the channel)';
      case 'invalid_auth':
        return '(hint: check the botToken, it looks invalid)';
      case 'account_inactive':
        return '(hint: the Slack bot token has been deactivated)';
      default:
        return '';
    }
  }
}
