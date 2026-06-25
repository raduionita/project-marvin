import { Channel, Message } from '../types.js';
import { Context } from '../context.js';

export default class TelegramChannel extends Channel {
  async attach(ctx: Context) : Promise<void> {
    console.log('telegram', 'attaching...', ctx.config.settings);
    console.log('telegram', 'attached!');
  }

  async submit(message: Message) {
    console.log('telegram', 'submit:', JSON.stringify(message));
  }

  async detach() {
    console.log('telegram', 'detaching...');
    console.log('telegram', 'detached');
  }
}
