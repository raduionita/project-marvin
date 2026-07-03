import { Channel, Message } from '../types.js';
import { Server } from '../server.js';

export default class ExampleChannel extends Channel {
  async init() : Promise<void> {
    console.log('[marvin]', 'ExampleChannel.init', 'attaching...', this.ctx.config.settings);
    // done
    console.log('[marvin]', 'ExampleChannel.init', 'attached!');
  }

  async sendMessage(message: Message) {
    console.log('[marvin]', 'ExampleChannel.submit', JSON.stringify(message));
  }

  async drop() {
    console.log('[marvin]', 'ExampleChannel.detach', 'detaching...');
    console.log('[marvin]', 'ExampleChannel.detach', 'detached');
  }
};
