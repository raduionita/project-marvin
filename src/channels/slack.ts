import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { WebClient, ChatPostMessageArguments, ChatPostMessageResponse } from '@slack/web-api';
import { Channel, Command, Message, ChannelMeta } from '../types.js';
import { Agent } from '../agent.js';
import type Engine from '../engine.js';
import { listCommands } from '../commands/index.js';
import { Logger } from '../logger.js';
import * as constants from '../constants.js';

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

  // slack uses its own logger, not the shared one passed down from the engine.
  // a logger can be injected for tests (captures output instead of the console).
  constructor(engine: Engine, logger: Logger = new Logger()) {
    super(engine, logger);
  }

  protected socketClient!: ISocketModeClient;
  protected webClient!: IWebClient;

  // the bot's user id, used to strip only the bot's own mention from messages
  protected botId: string = '';

  async load() {
    try {
      this.logger.debug('[SlackChannel.load]');

      const config = this.engine.config.channels.slack as SlackConfig | undefined;
      if (!config) {
        this.logger.error('[SlackChannel.load]', 'no settings found, skipping');
        return;
      }

      const appToken = (config?.appToken || process.env.SLACK_APP_TOKEN);
      if (!appToken || !appToken.startsWith('xapp-')) {
        this.logger.error('[SlackChannel.load]', 'no appToken found, skipping');
        return;
      }

      const botToken = (config?.botToken || process.env.SLACK_BOT_TOKEN);
      if (!botToken || !botToken.startsWith('xoxb-')) {
        this.logger.error('[SlackChannel.load]', 'no botToken found, skipping');
        return;
      }

      // create web client
      this.webClient = this.newWebClient(botToken);
      // verify the bot token is valid, and capture the bot's user id
      const auth = await this.webClient.auth.test();
      if (!auth.ok || !auth.user_id) {
        this.logger.error('[SlackChannel.load]', 'bot token invalid:', auth.error);
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
      this.socketClient.on('reconnecting', this.onReconnecting.bind(this));
      this.socketClient.on('reconnected', this.onReconnected.bind(this));
      this.socketClient.on('disconnected', this.onDisconnected.bind(this));

      // route Slack events to Marvin's AI loop
      this.socketClient.on('app_mention', this.onMention.bind(this));
      // the SocketMode client emits DM messages as "message" with channel_type "im"
      this.socketClient.on('message', this.onSocketMessage.bind(this));
      this.socketClient.on('slash_commands', this.onSlashCommand.bind(this));

      await this.socketClient.start();

      this.logger.debug('[SlackChannel.load]','channel slack started');
    } catch (err) {
      this.logger.warn('[SlackChannel.load]', 'error:', (err as Error).message);
    }
  }

  async drop() {
    this.logger.debug('[SlackChannel.drop]');
    if (this.socketClient) {
      await this.socketClient.disconnect();
      this.logger.debug('[SlackChannel.drop]','channel slack dropped');
    }
  }

  async info() : Promise<{ groups: { [key: string]: string } }> {
    this.logger.debug('[SlackChannel.info]');
    const response = await this.webClient.conversations.list({ 
      exclude_archived: true, 
      limit: 100,
    });
    if (!response || !response.ok || !response.channels) {
      this.logger.error('[SlackChannel.info]', 'error:', response.error);
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
      this.logger.debug('[SlackChannel.sendMessage]', `group=${message.group || '(none)'} thread=${message.thread || '(none)'} agent=${message.agent || '(none)'}`);

      // need web client
      if (!this.webClient) {
        this.logger.error('[SlackChannel.sendMessage]', 'not attached, skipping submit');
        return { ts: '', ok: false, error: 'web client not attached', message: '(slack not attached)' };
      }

      if (!message.group) {
        this.logger.warn('[SlackChannel.sendMessage]', 'no channel, skipping submit');
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
                '**Tokens**: `'  + (message.tokens || '(none)') + '`\n'
        },
      ]});

      // check if response is ok
      if (!response.ok) {
        const hint = this.errorToHint(response.error);
        this.logger.error('[SlackChannel.sendMessage]', 'response NOT ok:', response.error, hint);
        return { ts: '', ok: false, error: response.error, message: hint || '(slack response not ok)' };
      }

      // we should know if there is a mismatch between the channel in the message and the response
      if (response.channel !== message.group) {
        this.logger.error('[SlackChannel.sendMessage]', `channel mismatch: expected ${message.group}, got ${response.channel}`);
        return { ts: '', ok: false, error: response.error, message: '(slack channel mismatch)' };
      }

      return {
        ts: response.message?.ts || '',
        ok: true,
        error: response.error || '',
        message: response.message?.text || '',
        channel: response.channel || message.group || '',
      }
    } catch (error) {
      this.logger.error('[SlackChannel.sendMessage]', 'failed to send message:', error);
      return { ts: '', ok: false, error: (error as Error).message, message: '(slack sendMessage failed)' };
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

  protected async onMention({ event, body, ack }: HandlerParams) {
    const thread = event.thread_ts || event.ts || event.event_ts;
    try {
      this.logger.debug('[SlackChannel.onMention]', event.channel, thread, 'body=', JSON.stringify(body), 'event=', JSON.stringify(event));

      // extract the actual message text (strip @marvin mention)
      const text = this.cleanText(event.text || '');
      if (!text) {
        this.logger.warn('[SlackChannel.onMention]', 'no text content');
        return await ack({ text: '(no text content)' });
      }

      await ack();

      // find an agent that has slack configured
      const agent = this.findAgent(event.channel);
      const agentId = agent.id;
      const modelId = agent.model?.model;
      const chatId: string = `slack-${event.channel}-${thread}`;

      this.logger.info('[SlackChannel.onMention]', `processing via agent ${agentId}: ${text.slice(0, 100)}`);

      // forward to LLM // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await agent.sendChat(chatId, text);
      if (result.error) {
        this.logger.error('[SlackChannel.onMention]', `AI loop failed for agent ${agentId}:`, result.error);
        result.content = `(AI loop error: ${result.error})`;
      }

      // reply to user // send the result to the user
      const res = await this.sendMessage({ role: 'assistant', content: result.content || '(no response)', group: event.channel, thread, agent: agentId, model: modelId, tokens: result.tokens });
      if (!res.ok) {
        this.logger.warn('[SlackChannel.onMention]', 'failed to post reply:', res.error, res.message);
      }
    } catch (error) {
      this.logger.error('[SlackChannel.onMention]', error);
    }
  }

  protected async onDirectMessage({ event, body, ack }: HandlerParams) {
    const thread = event.thread_ts || event.ts || event.event_ts;
    try {
      this.logger.debug('[SlackChannel.onDirectMessage]', event.channel, thread);

      // extract the actual message text (strip @marvin mention)
      const text = this.cleanText(event.text || '');
      if (!text) {
        this.logger.warn('[SlackChannel.onDirectMessage]', 'no text content');
        return await ack({ text: '(no text content)' });
      }

      // acknowledge the event
      await ack();

      // find an agent that has slack configured
      const agent = this.findAgent(event.channel);
      const agentId = agent.id;
      const modelId = agent.model?.model;
      const chatId = `slack-${event.channel}-${thread}`;

      this.logger.info('[SlackChannel.onDirectMessage]', `processing via agent ${agentId}: ${text.slice(0, 100)}`);

      // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await agent.sendChat(chatId, text);
      if (result.error) {
        this.logger.error('[SlackChannel.onDirectMessage]', `AI loop failed for agent ${agentId}:`, result.error);
        result.content = `(AI loop error: ${result.error})`;
      }

      const res = await this.sendMessage({ role: 'assistant', content: result.content || '(no response)', group: event.channel, thread, agent: agentId, model: modelId, tokens: result.tokens });
      if (!res.ok) {
        this.logger.warn('[SlackChannel.onDirectMessage]', 'failed to post reply:', res.error, res.message);
      }
    } catch (error) {
      this.logger.error('[SlackChannel.onDirectMessage]', error);
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
        this.logger.info('[SlackChannel.onSlashCommand]', hint, '(available:', cmds.join(', '), ')');
        output = `${hint}\navailable commands: ${cmds.join(', ')}`;
      } else {
        output = await this.runCommand(name, args);
        this.logger.info('[SlackChannel.onSlashCommand]', `command ${name} output:\n${output}`);
      }

      const res = await this.sendMessage({ role: 'assistant', content: output || '(no output)', group: channelId });
      if (!res.ok) {
        this.logger.warn('[SlackChannel.onSlashCommand]', 'failed to post reply:', res.error, res.message);
      }
    } catch (error) {
      this.logger.error('[SlackChannel.onSlashCommand]', error);
    }
  }

  // route SocketMode "message" events: DM messages reach onDirectMessage,
  // everything else (bot's own messages, channel messages) is acknowledged & ignored
  protected async onSocketMessage({ event, body, ack }: HandlerParams) {
    try {
      const isBotOwn = event.subtype === 'bot_message' || !!event.bot_id;
      if (event.channel_type !== 'im' || isBotOwn) {
        return await ack({ text: '(ignored)' });
      }
      await this.onDirectMessage({ event, body, ack });
    } catch (error) {
      this.logger.error('[SlackChannel.onSocketMessage]', error);
    }
  }

  protected async onError(error: Error) {
    this.logger.error('[SlackChannel.onError]', error);
  }

  protected async onConnecting() {
    this.logger.info('[SlackChannel.onConnecting]', 'connecting?');
  }

  protected async onConnected() {
    this.logger.info('[SlackChannel.onConnected]', 'connected!');
  }

  protected async onReconnecting(attemptNumber: number) {
    this.logger.warn('[SlackChannel.onReconnecting]', `reconnecting... (${attemptNumber})`);
  }

  protected async onReconnected() {
    this.logger.warn('[SlackChannel.onReconnected]', 'reconnected!');
  }

  protected async onDisconnected(error: Error) {
    this.logger.warn('[SlackChannel.onDisconnected]', 'disconnected!', error);
  }

  // dynamically load a command class (mirrors marvin.ts execCommand), execute it
  // capturing its logger output, then drop it. each command gets its own logger
  // with an output override, so nothing is written to the global console
  protected async runCommand(name: string, args: string[]): Promise<string> {
    const Module = await import(`../commands/${name}.ts`);
    const Class = Module.default;
    if (!Class || !(Class.prototype instanceof Command)) {
      throw new Error(`${name} does not export a Command class`);
    }

    const lines: string[] = [];
    const capture = new Logger({
      // skip debug chatter, keep everything that would reach the user
      output: (level, line) => {
        if (level !== 'debug') {
          lines.push(line.map(String).join(' '));
        }
      },
    });

    const command = new Class(this.engine, capture, args);
    try {
      await command.exec();
    } finally {
      await command.drop();
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
    this.logger.debug('[SlackChannel.findAgent]', channel ? `channel=${channel}` : 'marvin');

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
