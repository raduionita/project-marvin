import { Channel, Message } from '../types.js';

export default class ExampleChannel extends Channel {
  args(): {[key: string]: any} {
    return {
      token: '',
    };
  }
  
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
