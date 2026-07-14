import { Channel, Message } from '../types.js';

export default class ExampleChannel extends Channel {
  args(): {[key: string]: any} {
    return {
      token: '',
    };
  }
  
  async init() : Promise<void> {
    console.log('ExampleChannel.init', 'attaching...', this.ctx.config.settings);
    // done
    console.log('ExampleChannel.init', 'attached!');
  }

  async sendMessage(message: Message) {
    console.log('ExampleChannel.submit', JSON.stringify(message));
  }

  async drop() {
    console.log('ExampleChannel.detach', 'detaching...');
    console.log('ExampleChannel.detach', 'detached');
  }
};
