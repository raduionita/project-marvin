import { Channel, Message } from '../types.js';

export default class WhatsAppChannel extends Channel {
  public args = {
    token: '',
  }

  async load() : Promise<void> {
    console.debug('[WhatsAppChannel.load]', 'attached', this.engine.config.settings);
  }

  async drop() {
    console.debug('[WhatsAppChannel.drop]', 'detached');
  }

  async sendMessage(message: Message) : Promise<any> {
    console.debug('[WhatsAppChannel.sendMessage]', JSON.stringify(message));
  }

  async listGroups(): Promise<{ [key: string]: string; }> {
    throw new Error('Method not implemented.');
  }
}
