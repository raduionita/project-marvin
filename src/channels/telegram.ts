import { Channel, Message } from '../types.js';
import { Server } from '../server.js';

export default class TelegramChannel extends Channel {
  async init(server: Server) : Promise<void> {
    const ctx = server.context;
    console.log('[marvin]', 'TelegramChannel.init', 'attaching...', ctx.config.settings);
    console.log('[marvin]', 'TelegramChannel.init', 'attached!');
  }

  async send(message: Message) {
    console.log('telegram', 'submit:', JSON.stringify(message));
  }

  async drop() {
    console.log('telegram', 'detaching...');
    console.log('telegram', 'detached');
  }
}
