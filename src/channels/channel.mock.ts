import { Channel, Message } from '../types.js';
import { Daemon } from '../daemon.js';

// Intentionally does NOT extend Channel — used to test validation in execChannels
export default class MockChannel extends Channel {
  async attach(daemon: Daemon): Promise<void> {
    console.log('[marvin]', 'MockChannel.attach', 'attached');
  }

  async submit(message: Message): Promise<void> {
    console.log('[marvin]', 'MockChannel.submit', JSON.stringify(message));
  }

  async detach(): Promise<void> {
    console.log('[marvin]', 'MockChannel.detach', 'detached');
  }
}
