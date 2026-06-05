import { type Plugin } from '@marvin/core';

export default {
  attach: (settings?: Record<string, any>) => {
    console.log('mock', 'attaching...', settings);
    console.log('mock', 'attached!');
  },

  detach: () => {
    console.log('mock', 'detaching...');
    console.log('mock', 'detached');
  }
}
