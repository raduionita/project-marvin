import { homedir } from 'os';
import { join } from 'path';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

import { tryJsonParse } from './helpers.js';
import { Config } from './types.js';
import { Context, loadContext } from './context.js';

async function initProject(ctx: Context) {
  console.log('[marvin]', 'initProject');

  // create project/workspace folder
  const wdir = join(homedir(), '.marvin');
  if (!existsSync(wdir)) {
    mkdirSync(wdir, { recursive: true });
  }

  ctx.wdir = wdir;

  // create marvin.json if missing
  const path = join(wdir, 'config.json');
  if (!existsSync(path)) {
    const config = {
      timestamp: Date.now(),
      settings: { name: 'marvin', port: 19384, logLevel: 'info' },
      channels: {},
      agents: {},
      models: {}
    } as Config;
    writeFileSync(path, JSON.stringify(config, null, 2));
  }
}

async function initConfig(ctx: Context) {
  console.log('[marvin]', 'initConfig');

  const path = join(ctx.wdir, 'marvin.json');
  
  let config = {} as Config;

  if (!existsSync(path)) {
    // throw error
    console.error('[marvin] Config file not found:', path);
  }

  const data = readFileSync(path, 'utf8');
  config = tryJsonParse(data);

  if (!config) {
    config = {
      timestamp: Date.now(),
      settings: { name: 'marvin', port: 19384, logLevel: 'info' },
      channels: {},
      agents: {},
      models: {}
    } as Config;
  }

  ctx.config = config;
}

async function  initHandlers() {
  process.on('SIGINT', () => {
    console.log('[marvin]', 'Client interrupted. Terminating...');
    process.exit(0);
  });
}

// send reload command to daemon
async function execReload() {
  console.log('[marvin]', 'execReload');
  const url = new URL('http://localhost:19384/');
  url.pathname = '/reload';
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`execReload: Error ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

export async function execClient() {
  const args = process.argv.slice(2);
  console.log('[marvin]', 'execClient', args);

  const ctx = loadContext();
        initHandlers();
  await initProject(ctx);
  await initConfig(ctx);

  if (args.includes('--reload')) {
    await execReload();
  }

  // Placeholder for interaction logic
  console.log('[marvin] Client is running. Press Ctrl+C to exit.');
  // Keep the client alive for demonstration
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log('[marvin] Finished.');
      resolve(null);
    }, 1000);
  });
}
