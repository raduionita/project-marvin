import { Channel, Message } from '../types.js';
import { Context } from '../context.js';

// Intentionally does NOT extend Channel — used to test validation in execChannels
export default class MockChannel extends Channel {
  args() {
    return {};
  }

  async init(): Promise<void> {
    console.log('[marvin]', 'MockChannel.init', 'initialized');
  }

  async sendMessage(message: Message): Promise<void> {
    console.log('[marvin]', 'MockChannel.send', JSON.stringify(message));
  }

  async drop(): Promise<void> {
    console.log('[marvin]', 'MockChannel.detach', 'dropped');
  }
}
