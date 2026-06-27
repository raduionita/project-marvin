import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { Channel, Message } from '../types.js';
import { Context } from '../context.js';

type HandlerParams = {event: {[key:string]:any}, body: Record<string,any>, ack: (response?:Record<string, unknown>) => Promise<void>};

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

    this.sok.on('app_mention', this.onMention.bind(this));
    this.sok.on('message.im', this.onMessage.bind(this));

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

  async send(message: Message) {
    if (!this.web) {
      console.warn('[marvin]', 'slack', 'not attached, skipping submit');
      return;
    }
    console.log('[marvin]', 'SlackChannel.send', JSON.stringify(message));
    await this.web.chat.postMessage({
      channel: message.group || '',
      text: message.content,
    });
  }

  private async onMention({event, body, ack}: HandlerParams) {
    try {
      console.info('[marvin]', 'SlackChannel.onMention', `channel=${event.channel}`);
      await ack();
      await this.web.chat.postMessage({
        channel: event.channel,
        text: 'app_mention',
      });
    } catch (error) {
      console.error('[marvin]', 'slack', 'app_mention', error);
    }
  }

  private async onMessage({event, body, ack} : HandlerParams) {
    try {
      console.info('[marvin]', 'SlackChannel.onMessage', `channel=${event.channel}`);
      await ack();
      await this.web.chat.postMessage({
        channel: event.channel,
        text: 'message.im',
      });
    } catch (error) {
      console.error('[marvin]', 'slack', 'message.im', error);
    }
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
}
