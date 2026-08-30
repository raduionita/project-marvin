import { Channel, Message, ChannelMeta } from '../types.js';
import logger from '../logger.js';

export default class WhatsAppChannel extends Channel {
  public meta: ChannelMeta = {
    name: 'whatsapp',
    arguments: {
      token: '',
    },
  }

  async load() : Promise<void> {
    logger.debug('[WhatsAppChannel.load]', 'attached', this.engine.config.settings);
  }

  async drop() {
    logger.debug('[WhatsAppChannel.drop]', 'detached');
  }

  async sendMessage(message: Message) : Promise<any> {
    logger.debug('[WhatsAppChannel.sendMessage]', JSON.stringify(message));
  }

  async info(): Promise<{ groups: { [key: string]: string } }> {
    throw new Error('Method not implemented.');
  }
}
