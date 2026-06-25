import { Channel, Message } from '../types.js';
import { Daemon } from '../daemon.js';

export default class TelegramChannel extends Channel {
  async attach(daemon: Daemon) : Promise<void> {
    const ctx = daemon.context;
    console.log('[marvin]', 'TelegramChannel.attach', 'attaching...', ctx.config.settings);
    console.log('[marvin]', 'TelegramChannel.attach', 'attached!');
  }

  async submit(message: Message) {
    console.log('telegram', 'submit:', JSON.stringify(message));
  }

  async detach() {
    console.log('telegram', 'detaching...');
    console.log('telegram', 'detached');
  }
}
