import { Channel, Message } from '../types.js';

export default class WhatsAppChannel extends Channel {
  public args = {
    token: '',
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
