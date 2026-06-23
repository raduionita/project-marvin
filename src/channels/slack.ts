import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { Channel } from '../types.js';
import { Context } from '../context.js';

export default class SlackChannel extends Channel {
  private sok!: SocketModeClient;
  private web!: WebClient;

  async attach(ctx: Context) {
    console.log('slack', 'attaching...', ctx.config.channels.slack);

    const settings = ctx.config.channels.slack;

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

    this.sok.on('error', (error) => { console.error('slack', error); });
    this.sok.on('connecting', () => { console.info('slack', 'connecting...'); });
    this.sok.on('connected', () => { console.info('slack', 'connected!'); });
    this.sok.on('reconnecting', (attemptNumber) => { console.warn('slack', `reconnecting... (${attemptNumber})`); });
    this.sok.on('reconnected', () => { console.warn('slack', 'reconnected!'); });
    this.sok.on('disconnected', (error) => { console.warn('slack', 'disconnected!', error); });

    this.sok.on('app_mention', async (event, body, ack) => {
      try {
        console.info('slack', 'app_mention', `channel=${event.channel}`);
        await ack();
        await this.web.chat.postMessage({
          channel: event.channel,
          text: 'app_mention',
        });
      } catch (error) {
        console.error('slack', 'app_mention', error);
      }
    });

    this.sok.on('message.im', async (event, body, ack) => {
      try {
        console.info('slack', 'message.im', `channel=${event.channel}`);
        await ack();
        await this.web.chat.postMessage({
          channel: event.channel,
          text: 'message.im',
        });
      } catch (error) {
        console.error('slack', 'message.im', error);
      }
    });

    await this.sok.start();
    console.log('slack', 'attached!');
  }

  detach() {
    if (this.sok) {
      console.log('slack', 'detaching...');
      this.sok.disconnect();
      console.log('slack', 'detached');
    }
  }
}
