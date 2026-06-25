import { homedir } from 'os';
import { join } from 'path';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

import { tryJsonParse } from './helpers.js';
import { Config, App } from './types.js';
import { Context } from './context.js';

export class Client extends App {

  async start(): Promise<void> {
    const args = process.argv.slice(2);
    console.log('[marvin]', 'Client.execClient', args);

    const ctx = new Context();
    this.initHandlers();
    await this.initProject(ctx);
    await this.initConfig(ctx);

    if (args.includes('--reload')) {
      await this.execReload(ctx);
    }

    // Placeholder for interaction logic
    console.log('[marvin] Client is running. Press Ctrl+C to exit.');
    // Keep the client alive for demonstration
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('[marvin] Finished.');
        resolve();
      }, 1000);
    });
  }

  async initProject(ctx: Context) {
    console.log('[marvin]', 'Client.initProject');

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

  async initConfig(ctx: Context) {
    console.log('[marvin]', 'Client.initConfig');

    const path = join(ctx.wdir, 'marvin.json');

    let config = {} as Config;

    if (!existsSync(path)) {
      // throw error
      console.error('[marvin]', 'Client.initConfig', 'Config file not found:', path);
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

  async initHandlers() {
    process.on('SIGINT', () => {
      console.log('[marvin]', 'Client.initHandlers', 'interrupted. Terminating...');
      process.exit(0);
    });
  }

  // send reload command to daemon
  async execReload(ctx: Context) {
    console.log('[marvin]', 'Client.execReload');
    const url = new URL(`http://localhost:${ctx.config.settings.port}/`);
    url.pathname = '/reload';
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Client.execReload: Error ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }
}

