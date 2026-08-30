import { Channel, Message, ChannelMeta } from '../types.js';
import logger from '../logger.js';

export default class TelegramChannel extends Channel {
  public meta: ChannelMeta = {
    name: 'telegram',
    arguments: {
      token: '',
    },
  }

  async load() : Promise<void> {
    logger.debug('[TelegramChannel.load]', 'attached', this.engine.config.settings);
  }
  
  async drop() {
    logger.debug('[TelegramChannel.drop]', 'detached');
  }
  
  async sendMessage(message: Message) : Promise<any> {
    logger.debug('[TelegramChannel.sendMessage]', 'submit:', JSON.stringify(message));
  }

  async info(): Promise<{ groups: { [key: string]: string } }> {
    throw new Error('Method not implemented.');
  }
}
