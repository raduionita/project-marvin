import { execDaemon } from './daemon.js';
import { execClient } from './client.js';

(async () => {
  const args = process.argv.slice(2);
  const isDaemon = args.includes('--daemon') || args.includes('-d');

  if (isDaemon) {
    console.log('[marvin] Starting Daemon mode...');
    await execDaemon();
  } else {
    console.log('[marvin] Starting Client mode...');
    await execClient();
  }
})().catch(err => {
  console.error('[marvin] Fatal error during startup:', err);
  process.exit(1);
});
