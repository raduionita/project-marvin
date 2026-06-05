import { config } from 'dotenv'

import { type Plugin } from './types.js';

config({path: '.env', debug: false, quiet: true});

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Exiting...');
  process.exit(0);
});

async function loadChannel(name:string): Promise<Plugin> {
  const plugin = await import(`../out/channels/${name}.js`);
  return plugin.default as Plugin;
}

(async () => {
  const mock = await loadChannel('mock');

  console.log(mock);

  mock.attach();
  mock.detach();
})();
