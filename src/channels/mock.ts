import { Context } from '../context.js';
import { Channel } from '../types.js';

export default class MockChannel implements Channel {
  async attach(ctx: Context) : Promise<void> {
    console.log('mock', 'attaching...', ctx.config.settings);
    // done
    console.log('mock', 'attached!');
  }

  async detach() {
    console.log('mock', 'detaching...');
    console.log('mock', 'detached');
  }
};
