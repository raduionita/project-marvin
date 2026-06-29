import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { Channel, Message, Agent } from '../types.js';
import { Context } from '../context.js';

type HandlerParams = { event: { [key: string]: any }, body: Record<string, any>, ack: (response?: Record<string, unknown>) => Promise<void> };

type SlackResponse = { ts: string; ok: boolean; error: string | undefined; message?: string, channel?: string };

export default class SlackChannel extends Channel {
  private sok!: SocketModeClient;
  private web!: WebClient;
  private ctx!: Context;

  async init(ctx: Context) {
    this.ctx = ctx;

    console.log('[marvin]', 'SlackChannel.init', this.ctx.config.channels.slack);

    const settings = this.ctx.config.channels.slack;

    const appToken = (settings?.appToken || process.env.SLACK_APP_TOKEN || 'NO_SLACK_APP_TOKEN');
    const botToken = (settings?.botToken || process.env.SLACK_BOT_TOKEN || 'NO_SLACK_BOT_TOKEN');

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
      channel: message.channel || '',
      text: message.content,
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

  private async onMention({ event, body, ack }: HandlerParams) {
    try {
      console.info('[marvin]', 'SlackChannel.onMention', `channel=${event.channel} thread=${event.thread_ts}|${event.ts}`);
      console.debug('[marvin]', 'SlackChannel.onMention', 'body=', JSON.stringify(body));
      console.debug('[marvin]', 'SlackChannel.onMention', 'event=', JSON.stringify(event));
      await ack();

      // TODO: on any error, try to message slack back with what happened

      // extract the actual message text (strip @marvin mention)
      const text = this.extractText(event);

      // find an agent that has slack configured
      const agent = this.findAgent(event);

      console.log('[marvin]', 'SlackChannel.onMention', `processing via agent ${agent.id}: ${text.slice(0, 100)}`);

      // get the server reference from context
      const server = this.ctx.server;
      // this should never happen, but just in case throw an error
      if (!server) {
        throw new Error('SlackChannel.onMention: server not available');
      }

      // TOOD: if thread_ts is empty, create a new session/thread, maybe this is not needed, just use event.ts/event.thread_ts

      const chatId: string = event.thread_ts;

      // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await server.sendChat(this.ctx, agent.id, chatId, text);

      if (!result) {
        console.error('[marvin]', 'SlackChannel.onMention', `no result from sendChat for agent ${agent.id}`);
        return;
      }

      // send response back to Slack, preserving thread if present
      const output: Message = { role: 'assistant', content: result.content, channel: event.channel, thread: event.thread_ts || event.ts };

      // TODO: if NOT a thread reply, create a new thread, replies from agents will be in a thread

      await this.sendMessage(output);
    } catch (error) {
      console.error('[marvin]', 'slack', 'app_mention', error);
    }
  }

  private async onDirectMessage({ event, body, ack }: HandlerParams) {
    try {
      console.info('[marvin]', 'SlackChannel.onDirectMessage', `channel=${event.channel}`);
      console.debug('[marvin]', 'SlackChannel.onDirectMessage', 'body=', JSON.stringify(body));
      console.debug('[marvin]', 'SlackChannel.onDirectMessage', 'event=', JSON.stringify(event));
      await ack();

      // extract the actual message text (strip @marvin mention)
      const text = this.extractText(event);

      // find an agent that has slack configured
      const agent = this.findAgent();

      console.log('[marvin]', 'SlackChannel.onDirectMessage', `processing via agent ${agent.id}: ${text.slice(0, 100)}`);

      // get the server reference from context
      const server = this.ctx.server;
      if (!server) {
        throw new Error('SlackChannel.onMention: server not available');
      }

      const sessionId = event.thread_ts;

      // process through Marvin's AI loop (executes model calls + tool execution)
      const result = await server.sendChat(this.ctx, agent.id, sessionId, text);

      if (!result) {
        console.error('[marvin]', 'SlackChannel.onDirectMessage', `no result from processMessage for agent ${agent.id}`);
        return;
      }

      // DMs don't have threads, just send a new message
      await this.sendMessage({ role: 'assistant', content: result.content });
    } catch (error) {
      console.error('[marvin]', 'slack', 'message.im', error);
    }
  }

  private async onSlashCommand({ event, body, ack }: HandlerParams) {
    console.info('[marvin]', 'SlackChannel.onSlashCommand', `command: ${body.collback_id}`, Object.keys(event), Object.keys(body), ack.toString());
    await ack({ text: `u want me to do /${body.collback_id}? ok whatever, it's not implemented yet, talk to the dev!` });

    // TODO: switch (body.collback_id) {
  }

  private async onError(error: Error) {
    console.error('[marvin]', 'SlackChannel.onError', error);
  }

  private async onConnecting() {
    console.info('[marvin]', 'SlackChannel.onConnecting', 'connecting...');
  }

  private async onConnected() {
    console.info('[marvin]', 'SlackChannel.onConnected', 'connected!');
  }

  private async onReconnecting(attemptNumber: number) {
    console.warn('[marvin]', 'SlackChannel.onReconnecting', `reconnecting... (${attemptNumber})`);
  }

  private async onReconnected() {
    console.warn('[marvin]', 'SlackChannel.onReconnected', 'reconnected!');
  }

  private async onDisconnected(error: Error) {
    console.warn('[marvin]', 'SlackChannel.onDisconnected', 'disconnected!', error);
  }

  // extract the actual text from a Slack event, stripping @marvin mention
  private extractText(event: { [key: string]: any }): string {
    let text = event.text || '';

    // TOOD: should remove @bot-name with "" NOT other user's @mentions

    // strip @marvin mention (Slack format: <@U12345>)
    text = text.replace(/<@[\w]+>/g, '').trim();

    // clean up extra whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text || '(no text content)';
  }

  // find agent using event.channel or fallback to default "marvin"
  private findAgent(event?: { [key: string]: any }): Agent {
    console.log('[marvin]', 'SlackChannel.findAgent', event?.channel);

    const ctx = this.ctx;

    // TODO: decide what agent to use, if multiple agents are enabled w/ slack...
    // - check agains the slack channel the message was sent to
    // - if the message was NOT on a bound channel, use the default/orchestrator agent "marvin"

    // find ir first enabled agent that has slack configured
    for (const agent of Object.values(ctx.agents)) {
      if (!agent.enabled) continue;

      // check if this agent has slack configured
      const channels = ctx.config.agents?.[agent.id]?.channels || {};
      if (channels.slack) {
        return agent;
      }
    }

    // TODO: fallback should be the orchestrator agent "marvin"

    // fallback: first enabled agent
    for (const agent of Object.values(ctx.agents)) {
      if (agent.enabled) {
        return agent;
      }
    }

    // TODO: never null, throw error just in case
    throw new Error('SlackChannel.findAgent: no agent found');
  }
}
