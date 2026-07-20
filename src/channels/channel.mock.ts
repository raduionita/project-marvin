import { Channel, Message } from '../types.js';
import { Context } from '../types.js';

// Intentionally does NOT extend Channel — used to test validation in execChannels
export default class MockChannel extends Channel {
  args() {
    return {};
  }

  async init(): Promise<void> {
    console.debug('[MockChannel.init]', 'initialized');
  }

  async sendMessage(message: Message): Promise<any> {
    console.debug('[MockChannel.send]', JSON.stringify(message));
  }

  async drop(): Promise<void> {
    console.debug('[MockChannel.detach]', 'dropped');
  }
}
