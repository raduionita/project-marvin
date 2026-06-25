import { Channel, Message } from '../types.js';
import { Context } from '../context.js';

export default class WhatsAppChannel extends Channel {
  async attach(ctx: Context) : Promise<void> {
    console.log('whatsapp', 'attaching...', ctx.config.settings);
    console.log('whatsapp', 'attached!');
  }

  async submit(message: Message) {
    console.log('whatsapp', 'submit:', JSON.stringify(message));
  }

  async detach() {
    console.log('whatsapp', 'detaching...');
    console.log('whatsapp', 'detached');
  }
}
