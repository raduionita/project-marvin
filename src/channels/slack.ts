import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { WebClient, ChatPostMessageArguments, ChatPostMessageResponse } from '@slack/web-api';
import { Channel, Message, Agent } from '../types.js';
import { extractOutput } from '../helpers.js';

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

  protected sok!: ISocketModeClient;
  protected web!: IWebClient;

  // the bot's user id, used to strip only the bot's own mention from messages
  protected botId: string = '';

  async load() {
    console.debug('[SlackChannel.load]', this.engine.config.channels.slack);

    if (this.engine.isDry) {
      console.debug('[SlackChannel.load]', '[dry] channel slack attached');
      return;
    }

    const config = this.engine.config.channels.slack as SlackConfig | undefined;
    if (!config) {
      console.error('[SlackChannel.load]', 'no settings found, skipping');
      return;
    }

    const appToken = (config?.appToken || process.env.SLACK_APP_TOKEN);
    if (!appToken) {
      console.error('[SlackChannel.load]', 'no appToken found, skipping');
      return;
    }

    const botToken = (config?.botToken || process.env.SLACK_BOT_TOKEN);
    if (!botToken) {
      console.error('[SlackChannel.load]', 'no botToken found, skipping');
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
      console.error('[SlackChannel.load]', 'prerequisite check failed, skipping:', prereqs.error);
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

    console.debug('[SlackChannel.load]','channel slack started');
    console.debug('[SlackChannel.load]', 'tip: subscribe "app_mention" and "message.im" events in the Slack App (Socket Mode) to receive messages');
  }

  async drop() {
    console.debug('[SlackChannel.drop]');
    if (this.sok) {
      await this.sok.disconnect();
      console.debug('[SlackChannel.drop]','channel slack dropped');
    }
  }

  // verify the Slack app is correctly set up before attaching
  protected async checkPrereqs(appToken: string | undefined, botToken: string | undefined): Promise<{ ok: boolean; botId?: string; error?: string }> {
    console.debug('[SlackChannel.checkPrereqs]');

    if (!appToken?.startsWith('xapp-')) {
      console.error('[SlackChannel.checkPrereqs]', 'appToken does not look like a socket-mode token (should start with "xapp-")');
      return { ok: false, error: 'appToken does not look like a socket-mode token (should start with "xapp-")' };
    }

    if (!botToken?.startsWith('xoxb-')) {
      console.error('[SlackChannel.checkPrereqs]', 'botToken does not look like a bot token (should start with "xoxb-")');
      return { ok: false, error: 'botToken does not look like a bot token (should start with "xoxb-")' };
    }

    // verify the bot token is valid, and capture the bot's user id
    const auth = await this.web.auth.test();
    if (!auth.ok || !auth.user_id) {
      console.error('[SlackChannel.checkPrereqs]', 'bot token invalid:', auth.error);
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
          console.error('[SlackChannel.checkPrereqs]', 'app token invalid:', conn.error);
          return { ok: false, error: `app token invalid: ${conn.error || 'unknown error'}` };
        }
        console.warn('[SlackChannel.checkPrereqs]', 'app token check transient failure:', conn.error, '(will retry via socket-mode auto-reconnect)');
      }
    } catch (err) {
      console.warn('[SlackChannel.checkPrereqs]', 'app token check failed:', (err as Error).message, '(will retry via socket-mode auto-reconnect)');
    }

    // verify we can list conversations (bot token scopes + bot added to channels)
    const conversations = await this.web.conversations.list({ limit: 1 });
    if (!conversations.ok) {
      console.error('[SlackChannel.checkPrereqs]', 'cannot list conversations:', conversations.error);
      return { ok: false, error: `cannot list conversations (missing scope / bot not added to any channel): ${conversations.error || 'unknown error'}` };
    }

    return { ok: true, botId: auth.user_id };
  }

  public async listGroups() : Promise<{[key:string]:string}> {
    console.debug('[SlackChannel.listGroups]');
    const response = await this.web.conversations.list({ 
      exclude_archived: true, 
      limit: 100,
    });
    if (!response || !response.ok || !response.channels) {
      console.error('[SlackChannel.listGroups]', 'error:', response.error);
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
    console.debug('[SlackChannel.sendMessage]', JSON.stringify(message));

    if (this.engine.isDry) {
      console.info('[SlackChannel.sendMessage]', '[dry] send message to:', message.channel);
      return { ts: '0000000000.000000', ok: true, error: '', message: '(dry)', channel: message.channel };
    }

    // need web client
    if (!this.web) {
      console.error('[SlackChannel.sendMessage]', 'not attached, skipping submit');
      throw new Error('[SlackChannel.sendMessage] web client not attached');
    }

    if (!message.channel) {
      console.warn('[SlackChannel.sendMessage]', 'no channel, skipping submit');
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
      console.error('[SlackChannel.sendMessage]', 'response NOT ok:', response.error, hint);
      return { ts: '', ok: false, error: response.error, message: hint || '(slack response not ok)' };
    }

    // we should know if there is a mismatch between the channel in the message and the response
    if (response.channel !== message.channel) {
      console.error('[SlackChannel.sendMessage]', `channel mismatch: expected ${message.channel}, got ${response.channel}`);
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

      console.debug('[SlackChannel.onMention]', event.channel, thread, 'body=', JSON.stringify(body), 'event=', JSON.stringify(event));
      
      // acknowledge the event // {text: constants.ACKS[Math.floor(Math.random() * constants.ACKS.length)]}
      await ack();

      // extract the actual message text (strip @marvin mention)
      const text = this.extractText(event);
      if (!text) {
        console.warn('[SlackChannel.onMention]', 'no text content');
        await this.sendMessage({ role: 'assistant', content: '(no text content)', channel: event.channel, thread: thread });
        return; 
      }

      // find an agent that has slack configured
      const agent = this.findAgent(event.channel);
      const agentId = agent.id;
      const chatId: string = `slack-${event.channel}-${thread}`;

      console.info('[SlackChannel.onMention]', `processing via agent ${agentId}: ${text.slice(0, 100)}`);

      // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await this.engine.execChat(chatId, agentId, text);
      if (!result) {
        console.error('[SlackChannel.onMention]', `no result from sendMessage for agent ${agentId}`);
        await this.sendMessage({ role: 'assistant', content: '(no response from the AI)', channel: event.channel, thread: thread });
        return;
      }

      const content = extractOutput(result.content);
      await this.sendMessage({ role: 'assistant', content, channel: event.channel, thread: thread });
    } catch (error) {
      console.error('[SlackChannel.onMention]', error);
    }
  }

  protected async onDirectMessage({ event, body, ack }: HandlerParams) {
    try {
      const thread = event.thread_ts || event.ts || event.event_ts;

      console.debug('[SlackChannel.onDirectMessage]', event.channel, thread, 'body=', JSON.stringify(body), 'event=', JSON.stringify(event));
      
      // acknowledge the event // {text: constants.ACKS[Math.floor(Math.random() * constants.ACKS.length)]}
      await ack();

      // extract the actual message text (strip @marvin mention)
      const text = this.extractText(event);
      if (!text) {
        console.warn('[SlackChannel.onDirectMessage]', 'no text content');
        await this.sendMessage({ role: 'assistant', content: '(no text content)', channel: event.channel, thread: thread });
        return;
      }

      // find an agent that has slack configured
      const agent = this.findAgent(event.channel);
      const agentId = agent.id;
      const chatId = `slack-${event.channel}-${thread}`;

      console.debug('[SlackChannel.onDirectMessage]', `processing via agent ${agentId}: ${text.slice(0, 100)}`);

      // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await this.engine.execChat(chatId, agentId, text);
      if (!result) {
        console.error('[SlackChannel.onDirectMessage]', `no result from processMessage for agent ${agentId}`);
        await this.sendMessage({ role: 'assistant', content: '(SlackChannel.onDirectMessage ERROR - no response from the AI)', channel: event.channel, thread: thread });
        return;
      }

      const content = extractOutput(result.content);
      await this.sendMessage({ role: 'assistant', content, channel: event.channel, thread: thread });
    } catch (error) {
      console.error('[SlackChannel.onDirectMessage]', error);
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
      console.error('[SlackChannel.onSocketMessage]', error);
    }
  }

  protected async onSlashCommand({ event, body, ack }: HandlerParams) {
    console.info('[SlackChannel.onSlashCommand]', `command: ${body.callback_id}`, Object.keys(event), Object.keys(body), ack.toString());
    await ack({ text: `u want me to do /${body.callback_id}? ok whatever, it's not implemented yet, talk to the dev!` });

    // TODO: switch (body.callback_id) {
  }

  protected async onError(error: Error) {
    console.error('[SlackChannel.onError]', error);
  }

  protected async onConnecting() {
    console.info('[SlackChannel.onConnecting]', 'connecting...');
  }

  protected async onConnected() {
    console.info('[SlackChannel.onConnected]', 'connected!');
  }

  protected async onReconnecting(attemptNumber: number) {
    console.warn('[SlackChannel.onReconnecting]', `reconnecting... (${attemptNumber})`);
  }

  protected async onReconnected() {
    console.warn('[SlackChannel.onReconnected]', 'reconnected!');
  }

  protected async onDisconnected(error: Error) {
    console.warn('[SlackChannel.onDisconnected]', 'disconnected!', error);
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
    console.debug('[SlackChannel.findAgent]', channel ? `channel=${channel}` : 'marvin');

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
