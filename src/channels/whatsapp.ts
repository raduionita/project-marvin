import { Channel, Message } from '../types.js';
import { Daemon } from '../daemon.js';

export default class WhatsAppChannel extends Channel {
  async attach(daemon: Daemon) : Promise<void> {
    const ctx = daemon.context;
    console.log('[marvin]', 'WhatsAppChannel.attach', 'attaching...', ctx.config.settings);
    console.log('[marvin]', 'WhatsAppChannel.attach', 'attached!');
  }

  async submit(message: Message) {
    console.log('whatsapp', 'submit:', JSON.stringify(message));
  }

  async detach() {
    console.log('whatsapp', 'detaching...');
    console.log('whatsapp', 'detached');
  }
}
