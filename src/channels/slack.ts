import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { WebClient, ChatPostMessageArguments, ChatPostMessageResponse } from '@slack/web-api';
import { Channel, Message, Agent } from '../types.js';
import { Context } from '../types.js';
import * as constants from '../constants.js';

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
}

export default class SlackChannel extends Channel {
  protected sok!: ISocketModeClient;
  protected web!: IWebClient;

  args() {
    return {
      appToken: 'xapp-1-yout-app-token-here',
      botToken: 'xbot-1-your-bot-token-here',
    };
  }

  async init() {
    console.log('[marvin]', 'SlackChannel.init', this.ctx.config.channels.slack);

    const config = this.ctx.config.channels.slack as SlackConfig;
    if (!config ) {
      console.error('[marvin]', 'SlackChannel.init', 'no settings found, skipping');
      return;
    }

    const appToken = (config?.appToken || process.env.SLACK_APP_TOKEN);
    if (!appToken) {
      console.error('[marvin]', 'SlackChannel.init', 'no appToken found, skipping');
      return;
    }

    const botToken = (config?.botToken || process.env.SLACK_BOT_TOKEN);
    if (!botToken) {
      console.error('[marvin]', 'SlackChannel.init', 'no botToken found, skipping');
      return;
    }

    this.sok = new SocketModeClient({
      appToken: appToken as string,
      logLevel: LogLevel.DEBUG,
      autoReconnectEnabled: true,
      clientOptions: { retryConfig: { retries: 5 } }
    });

    this.web = new WebClient(botToken, {
      logLevel: LogLevel.DEBUG,
      retryConfig: { retries: 5 }
    });

    this.sok.on('error', this.onError.bind(this));
    this.sok.on('connecting', this.onConnecting.bind(this));
    this.sok.on('connected', this.onConnected.bind(this));
    this.sok.on('reconnecting', this.onReconnecting.bind(this));
    this.sok.on('reconnected', this.onReconnected.bind(this));
    this.sok.on('disconnected', this.onDisconnected.bind(this));

    // route Slack events to Marvin's AI loop
    this.sok.on('app_mention', this.onMention.bind(this));
    this.sok.on('message.im', this.onDirectMessage.bind(this));
    this.sok.on('slash_commands', this.onSlashCommand.bind(this));

    await this.sok.start();

    console.log('[marvin]', 'SlackChannel.init', 'started');
  }

  async drop() {
    if (this.sok) {
      console.log('[marvin]', 'SlackChannel.drop');
      await this.sok.disconnect();
      console.log('[marvin]', 'SlackChannel.drop', 'dropped');
    }
  }

  // send a message to Slack, optionally as a thread reply
  async sendMessage(message: Message) : Promise<SlackResponse | undefined> {
    if (!this.web) {
      console.warn('[marvin]', 'SlackChannel.sendMessage', 'not attached, skipping submit');
      return;
    }

    console.log('[marvin]', 'SlackChannel.sendMessage', JSON.stringify(message));

    // send the message
    const response = await this.web.chat.postMessage({
      text: message.content,
      // OR .markdown_text
      // +  .mrkdwn
      channel: message.channel || '',
      thread_ts: message.thread || '',
    });

    // we should know if there is a mismatch between the channel in the message and the response
    if (response.channel !== message.channel) {
      console.warn('[marvin]', 'SlackChannel.sendMessage', `channel mismatch: expected ${message.channel}, got ${response.channel}`);
    }

    return {
      ts: response.ts || response.message?.ts || '',
      ok: response.ok,
      error: response.error,
      message: response.message?.text || '',
      channel: response.channel || message.channel || '',
    }
  }

  protected async onMention({ event, body, ack }: HandlerParams) {
    try {
      console.info('[marvin]', 'SlackChannel.onMention', `channel=${event.channel} thread=${event.thread_ts}|${event.ts}`);
      console.debug('[marvin]', 'SlackChannel.onMention', 'body=', JSON.stringify(body));
      console.debug('[marvin]', 'SlackChannel.onMention', 'event=', JSON.stringify(event));
      
      // acknowledge the event
      await ack({text: constants.ACKS[Math.floor(Math.random() * constants.ACKS.length)]});

      // extract the actual message text (strip @marvin mention)
      const text = this.extractText(event);
      if (!text) {
        console.warn('[marvin]', 'SlackChannel.onMention', 'no text content');
        await this.sendMessage({ role: 'assistant', content: '(no text content)' });
        return; 
      }

      // get the server reference from context
      const server = this.ctx.server;
      // this should never happen, but just in case throw an error
      if (!server) {
        console.error('[marvin]', 'SlackChannel.onMention', 'server not available');
        await this.sendMessage({ role: 'assistant', content: '(server not available)' });
        return;
      }

      // find an agent that has slack configured
      const agent = this.findAgent(event.channel);
      const thread = event.thread_ts || event.ts || event.event_ts;
      const agentId = agent.id;
      const chatId: string = `slack-${event.channel}-${thread}`;

      console.log('[marvin]', 'SlackChannel.onMention', `processing via agent ${agentId}: ${text.slice(0, 100)}`);

      // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await server.sendMessage(this.ctx, text, chatId, agentId);
      if (!result) {
        console.error('[marvin]', 'SlackChannel.onMention', `no result from sendMessage for agent ${agentId}`);
        await this.sendMessage({ role: 'assistant', content: '(no response from the AI)' });
        return;
      }

      await this.sendMessage({ role: 'assistant', content: result.content, channel: event.channel, thread: thread });
    } catch (error) {
      console.error('[marvin]', 'SlackChannel.onMention', error);
    }
  }

  protected async onDirectMessage({ event, body, ack }: HandlerParams) {
    try {
      console.info('[marvin]', 'SlackChannel.onDirectMessage', `channel=${event.channel}`);
      console.debug('[marvin]', 'SlackChannel.onDirectMessage', 'body=', JSON.stringify(body));
      console.debug('[marvin]', 'SlackChannel.onDirectMessage', 'event=', JSON.stringify(event));
      
      await ack({text: constants.ACKS[Math.floor(Math.random() * constants.ACKS.length)]});

      // extract the actual message text (strip @marvin mention)
      const text = this.extractText(event);

      // get the server reference from context
      const server = this.ctx.server;
      if (!server) {
        throw new Error('SlackChannel.onMention: server not available');
      }

      // find an agent that has slack configured
      const agent = this.findAgent(event.channel);
      const thread = event.thread_ts || event.ts || event.event_ts;
      const agentId = agent.id;
      const chatId = `slack-${event.channel}-${thread}`;

      console.log('[marvin]', 'SlackChannel.onDirectMessage', `processing via agent ${agentId}: ${text.slice(0, 100)}`);

      // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await server.sendMessage(this.ctx, text, chatId, agentId);

      if (!result) {
        console.error('[marvin]', 'SlackChannel.onDirectMessage', `no result from processMessage for agent ${agentId}`);
        return;
      }

      // DMs don't have threads, just send a new message
      await this.sendMessage({ role: 'assistant', content: result.content, channel: event.channel });
    } catch (error) {
      console.error('[marvin]', 'SlackChannel.onDirectMessage', error);
    }
  }

  protected async onSlashCommand({ event, body, ack }: HandlerParams) {
    console.info('[marvin]', 'SlackChannel.onSlashCommand', `command: ${body.collback_id}`, Object.keys(event), Object.keys(body), ack.toString());
    await ack({ text: `u want me to do /${body.collback_id}? ok whatever, it's not implemented yet, talk to the dev!` });

    // TODO: switch (body.collback_id) {
  }

  protected async onError(error: Error) {
    console.error('[marvin]', 'SlackChannel.onError', error);
  }

  protected async onConnecting() {
    console.info('[marvin]', 'SlackChannel.onConnecting', 'connecting...');
  }

  protected async onConnected() {
    console.info('[marvin]', 'SlackChannel.onConnected', 'connected!');
  }

  protected async onReconnecting(attemptNumber: number) {
    console.warn('[marvin]', 'SlackChannel.onReconnecting', `reconnecting... (${attemptNumber})`);
  }

  protected async onReconnected() {
    console.warn('[marvin]', 'SlackChannel.onReconnected', 'reconnected!');
  }

  protected async onDisconnected(error: Error) {
    console.warn('[marvin]', 'SlackChannel.onDisconnected', 'disconnected!', error);
  }

  // extract the actual text from a Slack event, stripping @marvin mention
  protected extractText(event: { [key: string]: any }): string {
    let text: string = (event.text || '');

    // TOOD: should remove @bot-name with "" NOT other user's @mentions
    // TODO: other user metions should be replaced with their names?

    // const marvin = `@${this.ctx.config.settings.name}`;

    // strip @marvin mention (Slack format: <@U12345>)
    text = text.replace(/<@[\w]+>/g, '').trim();

    // clean up extra whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  // find agent using event.channel or fallback to default "marvin"
  protected findAgent(channel?: string): Agent {
    console.log('[marvin]', 'SlackChannel.findAgent', channel ? `channel=${channel}` : 'marvin');

    // diretly use marvin/orchestrator agent
    if (!channel) {
      return this.ctx.agents[this.ctx.config.settings.name]!;
    }

    // find ir first enabled agent that has slack configured
    for (const agent of Object.values(this.ctx.agents)) {
      if (!agent.enabled) continue;

      // find the agent that has the slack+group configured
      if (agent.channels['slack'] === channel) {
        return agent;
      }
    }

    // fallback: default agent (settings.name), fallback doesnt need slack configured
    return this.ctx.agents[this.ctx.config.settings.name]!;
  }
}
