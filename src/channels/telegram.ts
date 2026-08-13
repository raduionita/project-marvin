import { Channel, Message } from '../types.js';

export default class TelegramChannel extends Channel {
  public args ={
    token: '',
  }

  async load() : Promise<void> {
    this.logger.debug('[TelegramChannel.load]', 'attached', this.engine.config.settings);
  }
  
  async drop() {
    this.logger.debug('[TelegramChannel.drop]', 'detached');
  }
  
  async sendMessage(message: Message) : Promise<any> {
    this.logger.debug('[TelegramChannel.sendMessage]', 'submit:', JSON.stringify(message));
  }

  async listGroups(): Promise<{ [key: string]: string; }> {
    throw new Error('Method not implemented.');
  }
}
