import { Channel, Message } from '../types.js';

export default class WhatsAppChannel extends Channel {
  args(): {[key: string]: any} {
    return {
      token: '',
    };
  }

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
