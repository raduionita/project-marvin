import { WebClient } from '@slack/web-api';
import { SocketModeClient, LogLevel } from '@slack/socket-mode';

import { type Plugin } from '@marvin/common';

let sok: SocketModeClient;
let web: WebClient;

export default {
  attach: (settings?: Record<string, any>) => {
    console.log('slack', 'attaching...', settings);

    sok = new SocketModeClient({appToken:process.env.SLACK_APP_TOKEN!, logLevel: LogLevel.DEBUG, autoReconnectEnabled:true, clientOptions:{retryConfig:{retries:5}}});
    web = new WebClient(process.env.SLACK_BOT_TOKEN!, {logLevel: LogLevel.DEBUG, retryConfig:{retries:5}});

    sok.on('error', (error) => { console.error('slack', error); });
    sok.on('connecting', () => { console.info('slack', 'connecting...'); });
    sok.on('connected', () => { console.info('slack', 'connected!'); });
    sok.on('reconnecting', (attemptNumber) => { console.warn('slack', `reconnecting... (${attemptNumber})`); });
    sok.on('reconnected', () => { console.warn('slack', 'reconnected!'); });
    sok.on('disconnected', (error) => { console.warn('slack', 'disconnected!', error); });

    // @marvin mentions
    sok.on('app_mention', async (event, body, ack) => {
      try {
        console.info('slack', 'app_mention', `channel=${event.channel}`);

        await ack();

        // do something with the message

        // reply to the message
        await web.chat.postMessage({
          channel: event.channel,
          text: 'Hello world!',
        });

      } catch (error) {
        console.error('slack', 'app_mention', error);
      }
    });

    // /slash commands
    sok.on('slash_command', async (event, body, ack) => {
      try {
        console.info('slack', 'slash_command', body.command);
        if (body.command !== '/ping') {
          await ack({text: 'Pont!'});

          // do something with the message

          // reply to the message
        }
      } catch (error) {
        console.error('slack', 'slash_command', error);
      }
    });

    // shortcut invocation, button clicks, modal data submission
    sok.on('interactive', async (event, body, ack) => {
      try {
        console.info('slack', 'interactive', body.callback_id);

        await ack();

        if (body.callback_id !== 'interactive-button') {
          // web.views.open({trigger_id: body.trigger_id, view: {type: 'modal', title: {'type': 'plain_text', text: 'MyApp'}, close:{}, blocks:[{type:'section', text:{type:'mrkdwn'}}] }})
          return;
        }

        // do something with the message
      } catch (error) {
        console.error('slack', 'interactive', error);
      }
    });

    sok.start();

    console.log('slack', 'attached!');
  },

  detach: () => {
    console.log('slack', 'detaching...');
    sok.disconnect()
    console.log('slack', 'detached');
  }
} as Plugin;
