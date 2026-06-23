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
  // SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    console.log('[marvin]', 'initHandlers', 'SIGINT');
    process.exit(0);
  });

  // SIGTERM (kill)
  process.on('SIGTERM', () => {
    console.log('[marvin]', 'initHandlers', 'SIGTERM');
    process.exit(0);
  });

  // unhandled rejection from promise
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[marvin]','initHandlers', 'unhandledRejection:', promise, 'reason:', reason);
    // TODO: decide if the rejection should trigger a shutdown
  });

  // uncaught exception
  process.on('uncaughtException', (err) => {
    console.error('[marvin]','initHandlers', 'uncaughtException:', err);
    // TODO: decide if the exception should trigger a shutdown
  });

  // process exit (graceful shutdown = stopDaemon)
  process.on('exit', async (code) => {
    console.log(`[marvin]','initHandlers', 'process.exit(${code})`);
    await stopDaemon(ctx);
  });
}

function initProject(ctx: Context) {
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

    console.log('[marvin]', 'initServer', `command: ${command}`);
    
    try {
      switch (command) {
        case 'reload':
          await execReload(ctx);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, data: {} }));
          break;
        default:
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Unknown command' }));
          return;
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
    }
  });

  server.on('error', (err) => {
    console.error('[marvin]', 'initServer', 'error:', err);
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
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding'
    ],
    // todo: proxies
  });

  ctx.browser = browser;
}

async function dropBrowser(ctx: Context) {
  console.log('[marvin]', 'dropBrowser');
  if (ctx.browser) {
    try {
      await ctx.browser.close();
    } catch (err) {
      console.error('[marvin]', 'dropBrowser', 'error:', err);
    }
    ctx.browser = null;
  }
}

async function initTools(ctx: Context) {
  console.log('[marvin]', 'initTools');

  // for each file (except index.ts) in tools folder
  // import dynamically and save it in context
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
  console.log('[marvin]', 'initAgents');
  // TODO: use config.agents to load each agent
  //   - agent.model = instance from initModels
  //   - for each agent.tasks: start setTimeout + execTask
}

async function execReload(ctx: Context) {
  console.log('[Context] Reloading systems...');
  await stopDaemon(ctx);
  // Re-initialization will be handled by the Daemon via initContext
}

async function stopDaemon(ctx: Context) {
  console.log('[marvin]', 'killDaemon');
  // guard against multiple calls
  if (!ctx.running) return;
  // mark as stopped
  ctx.running = false;

  // stop each system
  
  // stop server
  // dropServer(ctx);
  
  // stop browser
  dropBrowser(ctx);
}

export async function execDaemon() {
  console.log('[marvin]', 'execDaemon');

  const ctx = loadContext();

        initHandlers(ctx);
        initProject(ctx);
  await initConfig(ctx);
  await initServer(ctx);
  await initBrowser(ctx);
  await initTools(ctx);
  await initChannels(ctx);
  await initModels(ctx);
  await initAgents(ctx);
}
