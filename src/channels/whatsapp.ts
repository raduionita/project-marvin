import { Channel, Message } from '../types.js';
import { Server } from '../server.js';

export default class WhatsAppChannel extends Channel {
  async init() : Promise<void> {
    console.log('[marvin]', 'WhatsAppChannel.init', 'attaching...', this.ctx.config.settings);
    console.log('[marvin]', 'WhatsAppChannel.init', 'attached!');
  }

  async sendMessage(message: Message) {
    console.log('whatsapp', 'submit:', JSON.stringify(message));
  }

  async drop() {
    console.log('whatsapp', 'detaching...');
    console.log('whatsapp', 'detached');
  }
}
