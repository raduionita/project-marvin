import { Channel, Message } from '../types.js';
import { Daemon } from '../daemon.js';

export default class ExampleChannel extends Channel {
  async attach(daemon: Daemon) : Promise<void> {
    const ctx = daemon.context;
    console.log('[marvin]', 'ExampleChannel.attach', 'attaching...', ctx.config.settings);
    // done
    console.log('[marvin]', 'ExampleChannel.attach', 'attached!');
  }

  async submit(message: Message) {
    console.log('[marvin]', 'ExampleChannel.submit', JSON.stringify(message));
  }

  async detach() {
    console.log('[marvin]', 'ExampleChannel.detach', 'detaching...');
    console.log('[marvin]', 'ExampleChannel.detach', 'detached');
  }
};
