import { Context } from '../context.js';
import { Channel, Message } from '../types.js';

export default class ExampleChannel extends Channel {
  async attach(ctx: Context) : Promise<void> {
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
