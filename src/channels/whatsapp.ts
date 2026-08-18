import { Channel, Message, ChannelMeta } from '../types.js';

export default class WhatsAppChannel extends Channel {
  public meta: ChannelMeta = {
    name: 'whatsapp',
    arguments: {
      token: '',
    },
  }

  async load() : Promise<void> {
    this.logger.debug('[WhatsAppChannel.load]', 'attached', this.engine.config.settings);
  }

  async drop() {
    this.logger.debug('[WhatsAppChannel.drop]', 'detached');
  }

  async sendMessage(message: Message) : Promise<any> {
    this.logger.debug('[WhatsAppChannel.sendMessage]', JSON.stringify(message));
  }

  async listGroups(): Promise<{ [key: string]: string; }> {
    throw new Error('Method not implemented.');
  }
}
