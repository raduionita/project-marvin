import { Channel, Message } from '../types.js';

export default class WhatsAppChannel extends Channel {
  args(): {[key: string]: any} {
    return {
      token: '',
    };
  }

  async load() : Promise<void> {
    console.debug('[WhatsAppChannel.load]', 'attached', this.ctx.config.settings);
  }

  async sendMessage(message: Message) : Promise<any> {
    console.debug('[WhatsAppChannel.sendMessage]', JSON.stringify(message));
  }

  async drop() {
    console.debug('[WhatsAppChannel.drop]', 'detached');
  }
}
