import { Channel, Message } from '../types.js';

export default class TelegramChannel extends Channel {

  args(): {[key: string]: any} {
    return {
      token: '',
    };
  }

  async load() : Promise<void> {
    console.debug('[TelegramChannel.load]', 'attached', this.ctx.config.settings);
  }

  async sendMessage(message: Message) : Promise<any> {
    console.debug('[TelegramChannel.sendMessage]', 'submit:', JSON.stringify(message));
  }

  async drop() {
    console.debug('[TelegramChannel.drop]', 'detached');
  }
}
