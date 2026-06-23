import * as http from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

import { Context, loadContext } from './context.js';
import { tryJsonParse } from './helpers.js';
import { Config } from './types.js';

function initHandlers(ctx: Context) {
  const handleSignal = async (signal: string) => {
    console.log(`[marvin] Received ${signal}`);
    await dropDaemon(ctx);
    process.exit(0);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[marvin] unhandledRejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[marvin] uncaughtException:', err);
    dropDaemon(ctx).then(() => process.exit(1));
  });

  process.on('exit', (code) => {
    console.log(`[marvin] process.exit(${code})`);
  });
}

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

async function initServer(ctx: Context) {
  console.log('[marvin]', 'initServer');

  const port = ctx.config.settings.port || 19384;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const command = url.pathname.split('/')[1];

    if (!command) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'No command provided' }));
      return;
    }

    console.log(`[marvin] Received request: ${command}`);

    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: `Command ${command} executed` }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`[marvin] HTTP Server listening on port ${port}`);
      resolve();
    });
  });
}

async function initBrowser(ctx: Context) {
  chromium.use(stealth());

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
    ],
    // todo: proxies
  });

  ctx.browser = browser;
}

async function initChannels(ctx: Context) {
  // TODO: load channels from config.channels using channelsRegistry
  console.log('[marvin] Channels initialization (TBD)');
}

async function initModels(ctx: Context) {
  // TODO: use config.models to create Model instances via models/index.ts loadModel
  console.log('[marvin] Models initialization (TBD)');
}

async function initAgents(ctx: Context) {
  // TODO: use config.agents to load each agent
  //   - agent.model = instance from initModels
  //   - for each agent.tasks: start setTimeout + execTask
  console.log('[marvin] Agents initialization (TBD)');
}

async function execReload(ctx: Context) {
  console.log('[Context] Reloading systems...');
  await dropDaemon(ctx);
  // Re-initialization will be handled by the Daemon via initContext
}

async function dropDaemon(ctx: Context) {
  console.log('[Context] Starting graceful shutdown...');

  // 1. Stop Agents & Tasks first to prevent new work
  for (const agent of ctx.agents.values()) {
    // In a real implementation, we'd call agent.cleanup()
  }

  // 2. Close Channels and Models
  for (const channel of ctx.channels.values()) {
    try {
      await channel.detach();
    } catch (err) {
      console.error('[Context] Error detaching channel:', err);
    }
  }

  // 3. Close Browser
  if (ctx.browser) {
    try {
      await ctx.browser.close();
    } catch (err) {
      console.error('[Context] Error closing browser:', err);
    }
    ctx.browser = null;
  }

  console.log('[Context] Shutdown complete.');
}

export async function execDaemon() {
  console.log('[marvin]', 'execDaemon');

  const ctx = loadContext();

  initHandlers(ctx);

  initProject(ctx);

  await initConfig(ctx);
  await initServer(ctx);
  await initBrowser(ctx);
  await initChannels(ctx);
  await initModels(ctx);
  await initAgents(ctx);
}
