#!/usr/bin/env node

import { Server } from './server.js';
import { Client } from './client.js';
import { Context } from './types.js';
import { configDotenv } from 'dotenv';

configDotenv({ encoding: 'utf8', quiet: true, path: ['.env', '.env.local'] });

(async () => {
  const ctx = new Context();
  
  const args = process.argv.slice(2);
  const isServer = args.includes('--server') || args.includes('--serve') || args.includes('--daemon');

  if (isServer) {
    console.log('[marvin] starting daemon mode...');
    const server = new Server(ctx);
    await server.init();
  } else {
    console.log('[marvin] starting client mode...');
    const client = new Client(ctx);
    await client.init();
  }
})().catch(err => {
  console.error('[marvin] fatal error during startup:', err);
  process.exit(1);
});
