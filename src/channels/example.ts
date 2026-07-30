import { Channel, Message } from '../types.js';

export default class ExampleChannel extends Channel {
  public args = {
    token: '',
  }
  
  async load() : Promise<void> {
    console.debug('[ExampleChannel.load]', 'attached', this.engine.config.settings);
  }

  async sendMessage(message: Message) : Promise<any> { 
    console.debug('[ExampleChannel.submit]', JSON.stringify(message));
  }

  async drop() {
    console.debug('[ExampleChannel.detach]', 'detached');
  }
};
