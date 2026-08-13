import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { WebClient, ChatPostMessageArguments, ChatPostMessageResponse } from '@slack/web-api';
import { Channel, Command, Message, Agent } from '../types.js';
import type Engine from '../engine.js';
import { extractOutput } from '../helpers.js';
import { listCommands } from '../commands/index.js';
import { Logger } from '../logger.js';

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
  apps: {
    connections: {
      // validates the app token (xapp-) and returns a temporary WSS URL
      open: (args?: any) => Promise<any>;
    };
  };
}

export default class SlackChannel extends Channel {
  public args = {
    appToken: 'xapp-1-yout-app-token-here',
    botToken: 'xbot-1-your-bot-token-here',
  }

  // slack uses its own logger, not the shared one passed down from the engine.
  // a logger can be injected for tests (captures output instead of the console).
  constructor(engine: Engine, logger: Logger = new Logger()) {
    super(engine, logger);
  }

  protected sok!: ISocketModeClient;
  protected web!: IWebClient;

  // the bot's user id, used to strip only the bot's own mention from messages
  protected botId: string = '';

  async load() {
    this.logger.debug('[SlackChannel.load]');

    if (this.engine.isDry) {
      this.logger.debug('[SlackChannel.load]', '[dry] channel slack attached');
      return;
    }

    const config = this.engine.config.channels.slack as SlackConfig | undefined;
    if (!config) {
      this.logger.error('[SlackChannel.load]', 'no settings found, skipping');
      return;
    }

    const appToken = (config?.appToken || process.env.SLACK_APP_TOKEN);
    if (!appToken) {
      this.logger.error('[SlackChannel.load]', 'no appToken found, skipping');
      return;
    }

    const botToken = (config?.botToken || process.env.SLACK_BOT_TOKEN);
    if (!botToken) {
      this.logger.error('[SlackChannel.load]', 'no botToken found, skipping');
      return;
    }

    this.sok = new SocketModeClient({
      appToken: appToken as string,
      logLevel: LogLevel.ERROR,
      autoReconnectEnabled: true,
      clientOptions: { retryConfig: { retries: 5 } }
    });

    this.web = new WebClient(botToken, {
      logLevel: LogLevel.ERROR,
      retryConfig: { retries: 5 }
      
    });

    // verify the Slack app is correctly set up before attaching
    const prereqs = await this.checkPrereqs(appToken, botToken);
    if (!prereqs.ok) {
      this.logger.error('[SlackChannel.load]', 'prerequisite check failed, skipping:', prereqs.error);
      return;
    }
    this.botId = prereqs.botId!;

    this.sok.on('error', this.onError.bind(this));
    this.sok.on('connecting', this.onConnecting.bind(this));
    this.sok.on('connected', this.onConnected.bind(this));
    this.sok.on('reconnecting', this.onReconnecting.bind(this));
    this.sok.on('reconnected', this.onReconnected.bind(this));
    this.sok.on('disconnected', this.onDisconnected.bind(this));

    // route Slack events to Marvin's AI loop
    this.sok.on('app_mention', this.onMention.bind(this));
    // the SocketMode client emits DM messages as "message" with channel_type "im"
    this.sok.on('message', this.onSocketMessage.bind(this));
    this.sok.on('slash_commands', this.onSlashCommand.bind(this));

    await this.sok.start();

    this.logger.debug('[SlackChannel.load]','channel slack started');
    this.logger.debug('[SlackChannel.load]', 'tip: subscribe "app_mention" and "message.im" events in the Slack App (Socket Mode) to receive messages');
  }

  async drop() {
    this.logger.debug('[SlackChannel.drop]');
    if (this.sok) {
      await this.sok.disconnect();
      this.logger.debug('[SlackChannel.drop]','channel slack dropped');
    }
  }

  // verify the Slack app is correctly set up before attaching
  protected async checkPrereqs(appToken: string | undefined, botToken: string | undefined): Promise<{ ok: boolean; botId?: string; error?: string }> {
    this.logger.debug('[SlackChannel.checkPrereqs]');

    if (!appToken?.startsWith('xapp-')) {
      this.logger.error('[SlackChannel.checkPrereqs]', 'appToken does not look like a socket-mode token (should start with "xapp-")');
      return { ok: false, error: 'appToken does not look like a socket-mode token (should start with "xapp-")' };
    }

    if (!botToken?.startsWith('xoxb-')) {
      this.logger.error('[SlackChannel.checkPrereqs]', 'botToken does not look like a bot token (should start with "xoxb-")');
      return { ok: false, error: 'botToken does not look like a bot token (should start with "xoxb-")' };
    }

    // verify the bot token is valid, and capture the bot's user id
    const auth = await this.web.auth.test();
    if (!auth.ok || !auth.user_id) {
      this.logger.error('[SlackChannel.checkPrereqs]', 'bot token invalid:', auth.error);
      return { ok: false, error: `bot token invalid: ${auth.error || 'unknown error'}` };
    }

    // verify the app token (xapp-) is valid: requesting a WSS URL exercises the
    // same apps.connections.open call the socket-mode client uses at start()
    try {
      const conn = await this.web.apps.connections.open({ token: appToken });
      if (!conn.ok) {
        // only hard-fail on unrecoverable auth errors; transient ones
        // (internal_error, ...) are left to the socket-mode auto-reconnect
        const hard = ['not_authed', 'invalid_auth', 'account_inactive', 'user_removed_from_team', 'team_disabled'].includes(conn.error);
        if (hard) {
          this.logger.error('[SlackChannel.checkPrereqs]', 'app token invalid:', conn.error);
          return { ok: false, error: `app token invalid: ${conn.error || 'unknown error'}` };
        }
        this.logger.warn('[SlackChannel.checkPrereqs]', 'app token check transient failure:', conn.error, '(will retry via socket-mode auto-reconnect)');
      }
    } catch (err) {
      this.logger.warn('[SlackChannel.checkPrereqs]', 'app token check failed:', (err as Error).message, '(will retry via socket-mode auto-reconnect)');
    }

    // verify we can list conversations (bot token scopes + bot added to channels)
    const conversations = await this.web.conversations.list({ limit: 1 });
    if (!conversations.ok) {
      this.logger.error('[SlackChannel.checkPrereqs]', 'cannot list conversations:', conversations.error);
      return { ok: false, error: `cannot list conversations (missing scope / bot not added to any channel): ${conversations.error || 'unknown error'}` };
    }

    return { ok: true, botId: auth.user_id };
  }

  public async listGroups() : Promise<{[key:string]:string}> {
    this.logger.debug('[SlackChannel.listGroups]');
    const response = await this.web.conversations.list({ 
      exclude_archived: true, 
      limit: 100,
    });
    if (!response || !response.ok || !response.channels) {
      this.logger.error('[SlackChannel.listGroups]', 'error:', response.error);
      return {};
    }
    // id=>name map
    const channels: {[key:string]:string} = {};
    for (const channel of response.channels) {
      const id = channel.id || channel.user || channel.name;
      if (!id) continue;
      channels[id] = channel.name || id;
    }
    return channels;
  }

  // send a message to Slack, optionally as a thread reply
  public async sendMessage(message: Message) : Promise<SlackResponse> {
    this.logger.debug('[SlackChannel.sendMessage]', JSON.stringify(message));

    if (this.engine.isDry) {
      this.logger.info('[SlackChannel.sendMessage]', '[dry] send message to:', message.channel);
      return { ts: '0000000000.000000', ok: true, error: '', message: '(dry)', channel: message.channel };
    }

    // need web client
    if (!this.web) {
      this.logger.error('[SlackChannel.sendMessage]', 'not attached, skipping submit');
      throw new Error('[SlackChannel.sendMessage] web client not attached');
    }

    if (!message.channel) {
      this.logger.warn('[SlackChannel.sendMessage]', 'no channel, skipping submit');
      throw new Error('[SlackChannel.sendMessage] no channel provided');
    }

    // send the message
    const response = await this.web.chat.postMessage({
      text: message.content,
      // OR .markdown_text
      // +  .mrkdwn
      channel: message.channel,
      thread_ts: message.thread || undefined,
    });

    // check if response is ok
    if (!response.ok) {
      const hint = this.slackErrorHint(response.error);
      this.logger.error('[SlackChannel.sendMessage]', 'response NOT ok:', response.error, hint);
      return { ts: '', ok: false, error: response.error, message: hint || '(slack response not ok)' };
    }

    // we should know if there is a mismatch between the channel in the message and the response
    if (response.channel !== message.channel) {
      this.logger.error('[SlackChannel.sendMessage]', `channel mismatch: expected ${message.channel}, got ${response.channel}`);
      return { ts: '', ok: false, error: response.error, message: '(slack channel mismatch)' };
    }

    return {
      ts: response.message?.ts || '',
      ok: true,
      error: response.error || '',
      message: response.message?.text || '',
      channel: response.channel || message.channel || '',
    }
  }

  protected async onMention({ event, body, ack }: HandlerParams) {
    try {
      const thread = event.thread_ts || event.ts || event.event_ts;

      this.logger.debug('[SlackChannel.onMention]', event.channel, thread, 'body=', JSON.stringify(body), 'event=', JSON.stringify(event));
      
      // acknowledge the event // {text: constants.ACKS[Math.floor(Math.random() * constants.ACKS.length)]}
      await ack();

      // extract the actual message text (strip @marvin mention)
      const text = this.extractText(event);
      if (!text) {
        this.logger.warn('[SlackChannel.onMention]', 'no text content');
        await this.sendMessage({ role: 'assistant', content: '(no text content)', channel: event.channel, thread: thread });
        return; 
      }

      // find an agent that has slack configured
      const agent = this.findAgent(event.channel);
      const agentId = agent.id;
      const chatId: string = `slack-${event.channel}-${thread}`;

      this.logger.info('[SlackChannel.onMention]', `processing via agent ${agentId}: ${text.slice(0, 100)}`);

      // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await this.engine.execChat(chatId, agentId, text);
      if (!result) {
        this.logger.error('[SlackChannel.onMention]', `no result from sendMessage for agent ${agentId}`);
        await this.sendMessage({ role: 'assistant', content: '(no response from the AI)', channel: event.channel, thread: thread });
        return;
      }

      const content = extractOutput(result.content);
      await this.sendMessage({ role: 'assistant', content, channel: event.channel, thread: thread });
    } catch (error) {
      this.logger.error('[SlackChannel.onMention]', error);
    }
  }

  protected async onDirectMessage({ event, body, ack }: HandlerParams) {
    try {
      const thread = event.thread_ts || event.ts || event.event_ts;

      this.logger.debug('[SlackChannel.onDirectMessage]', event.channel, thread);
      
      // acknowledge the event // {text: constants.ACKS[Math.floor(Math.random() * constants.ACKS.length)]}
      await ack();

      // extract the actual message text (strip @marvin mention)
      const text = this.extractText(event);
      if (!text) {
        this.logger.warn('[SlackChannel.onDirectMessage]', 'no text content');
        await this.sendMessage({ role: 'assistant', content: '(no text content)', channel: event.channel, thread: thread });
        return;
      }

      // find an agent that has slack configured
      const agent = this.findAgent(event.channel);
      const agentId = agent.id;
      const chatId = `slack-${event.channel}-${thread}`;

      this.logger.debug('[SlackChannel.onDirectMessage]', `processing via agent ${agentId}: ${text.slice(0, 100)}`);

      // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await this.engine.execChat(chatId, agentId, text);
      if (!result) {
        this.logger.error('[SlackChannel.onDirectMessage]', `no result from processMessage for agent ${agentId}`);
        await this.sendMessage({ role: 'assistant', content: '(SlackChannel.onDirectMessage ERROR - no response from the AI)', channel: event.channel, thread: thread });
        return;
      }

      const content = extractOutput(result.content);
      await this.sendMessage({ role: 'assistant', content, channel: event.channel, thread: thread });
    } catch (error) {
      this.logger.error('[SlackChannel.onDirectMessage]', error);
    }
  }

  // route SocketMode "message" events: DM messages reach onDirectMessage,
  // everything else (bot's own messages, channel messages) is acknowledged & ignored
  protected async onSocketMessage({ event, body, ack }: HandlerParams) {
    try {
      const isBotOwn = event.subtype === 'bot_message' || !!event.bot_id;
      if (event.channel_type !== 'im' || isBotOwn) {
        await ack();
        return;
      }
      await this.onDirectMessage({ event, body, ack });
    } catch (error) {
      this.logger.error('[SlackChannel.onSocketMessage]', error);
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

      const cmds = listCommands(this.engine).map(f => f.replace(/\.ts$/, '')).filter(c => !SLASH_BLOCKED_COMMANDS.includes(c));

      // acknowledge immediately (Slack requires ack within ~3s), the result is posted afterwards
      await ack({ text: `running /marvin ${name}${args.length ? ' ' + args.join(' ') : ''}...` });

      if (!cmds.includes(name)) {
        const hint = SLASH_BLOCKED_COMMANDS.includes(name)
          ? `${name} cannot be run from slack`
          : `unknown command: ${name}`;
        this.logger.info('[SlackChannel.onSlashCommand]', hint, '(available:', cmds.join(', '), ')');
        await this.sendMessage({ role: 'assistant', content: `${hint}\navailable commands: ${cmds.join(', ')}`, channel: channelId });
        return;
      }

      const output = await this.runCommand(name, args);

      this.logger.info('[SlackChannel.onSlashCommand]', `command ${name} output:\n${output}`);
      await this.sendMessage({ role: 'assistant', content: output || '(no output)', channel: channelId });
    } catch (error) {
      this.logger.error('[SlackChannel.onSlashCommand]', error);
    }
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

  protected async onError(error: Error) {
    this.logger.error('[SlackChannel.onError]', error);
  }

  protected async onConnecting() {
    this.logger.info('[SlackChannel.onConnecting]', 'connecting...');
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

  // extract the actual text from a Slack event, stripping ONLY the bot's own mention
  protected extractText(event: { [key: string]: any }): string {
    let text: string = (event.text || '');

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
      return this.engine.agents[this.engine.config.settings.name]!;
    }

    // find ir first enabled agent that has slack configured
    for (const agent of Object.values(this.engine.agents)) {
      if (!agent.enabled) continue;

      // find the agent that has the slack+group configured
      if (agent.channels['slack'] === channel) {
        return agent;
      }
    }

    // fallback: default agent (settings.name), fallback doesnt need slack configured
    return this.engine.agents[this.engine.config.settings.name]!;
  }

  // translate common Slack API errors into actionable hints
  protected slackErrorHint(error: string | undefined): string {
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
