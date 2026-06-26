import { Server } from './server.js';
import { Client } from './client.js';

(async () => {
  const args = process.argv.slice(2);
  const isServer = args.includes('--server');

  if (isServer) {
    console.log('[marvin] Starting Daemon mode...');
    const server = new Server();
    await server.init();
  } else {
    console.log('[marvin] Starting Client mode...');
    const client = new Client();
    await client.init();
  }
})().catch(err => {
  console.error('[marvin] Fatal error during startup:', err);
  process.exit(1);
});
