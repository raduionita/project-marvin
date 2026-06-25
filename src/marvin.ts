import { Daemon } from './daemon.js';
import { Client } from './client.js';

(async () => {
  const args = process.argv.slice(2);
  const isDaemon = args.includes('--daemon') || args.includes('-d');

  if (isDaemon) {
    console.log('[marvin] Starting Daemon mode...');
    const daemon = new Daemon();
    await daemon.start();
  } else {
    console.log('[marvin] Starting Client mode...');
    const client = new Client();
    await client.start();
  }
})().catch(err => {
  console.error('[marvin] Fatal error during startup:', err);
  process.exit(1);
});
