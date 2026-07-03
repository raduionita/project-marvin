import { Channel, Message } from '../types.js';

export default class TelegramChannel extends Channel {
  async init() : Promise<void> {
    console.log('[marvin]', 'TelegramChannel.init', 'attaching...', this.ctx.config.settings);
    console.log('[marvin]', 'TelegramChannel.init', 'attached!');
  }

  async sendMessage(message: Message) {
    console.log('telegram', 'submit:', JSON.stringify(message));
  }

  async drop() {
    console.log('telegram', 'detaching...');
    console.log('telegram', 'detached');
  }
}
