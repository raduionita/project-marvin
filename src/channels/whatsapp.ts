import { Channel, Message } from '../types.js';
import { Server } from '../server.js';

export default class WhatsAppChannel extends Channel {
  async init(server: Server) : Promise<void> {
    const ctx = server.ctx;
    console.log('[marvin]', 'WhatsAppChannel.init', 'attaching...', ctx.config.settings);
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
