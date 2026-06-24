import * as http from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

import { Context, loadContext } from './context.js';
import { tryJsonParse } from './helpers.js';
import { Config, Model, Agent, Task, Chat, Tool } from './types.js';
import { listTools } from './tools/index.js';

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
    console.error('[marvin]', 'initHandlers', 'unhandledRejection:', promise, 'reason:', reason);
    // TODO: decide if the rejection should trigger a shutdown
  });

  // uncaught exception
  process.on('uncaughtException', (err) => {
    console.error('[marvin]', 'initHandlers', 'uncaughtException:', err);
    // TODO: decide if the exception should trigger a shutdown
  });

  // process exit (graceful shutdown = stopDaemon)
  process.on('exit', async (code) => {
    console.log('[marvin]', 'initHandlers', `process.exit(${code})`);
    await dropDaemon(ctx);
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
    console.error('[marvin]', 'initConfig', 'Config file not found:', path);
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

function initWatch(ctx: Context) {
  console.log('[marvin]', 'initWatch');

  const mpath = join(ctx.wdir, 'marvin.json');
  try {
    watch(mpath, () => {
      console.log('[marvin]', 'initWatch', 'config file changed, reloading...');
      execReload(ctx);
    });
  } catch (err) {
    console.warn('[marvin]', 'initWatch', 'config file watcher failed:', (err as Error).message);
  }
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
    ctx.server = server;
    server.listen(port, () => {
      console.log(`[marvin] HTTP Server listening on port ${port}`);
      resolve();
    });
  });
}

async function initBrowser(ctx: Context) {
  console.log('[marvin]', 'initBrowser');

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
  
  const files = listTools();
  for (const file of files) {
    const moduleName = file.replace('.ts', '');
    try {
      const Module = await import(`./tools/${moduleName}.js`);
      const Class = Module.default || (Module as any)[moduleName.charAt(0).toUpperCase() + moduleName.slice(1)];
      if (!Class || !(Class.prototype instanceof Tool)) {
        console.warn('[marvin]', 'initTools', `${file} does not export a Tool class, skipping`);
        continue;
      }
      const instance = new (Class as new (ctx: Context) => Tool)(ctx);
      if (moduleName !== instance.name()) {
        console.warn('[marvin]', 'initTools', `${file}: module name "${moduleName}" does not match tool name "${instance.name()}", skipping`);
        continue;
      }
      ctx.tools[instance.name()] = instance;
      console.log('[marvin]', 'initTools', `loaded: ${instance.name()}`);
    } catch (err) {
      console.error('[marvin]', 'initTools', `failed to load ${file}:`, err);
    }
  }
}

async function initChannels(ctx: Context) {
  // TODO: load channels from config.channels using channelsRegistry
  console.log('[marvin]', 'initChannels', 'Channels initialization (TBD)');
}

async function initModels(ctx: Context) {
  console.log('[marvin]', 'initModels');
  // dynamically load models from models/
  for (const [id, model] of Object.entries(ctx.config.models)) {
    if (!model.enabled) continue;
    try {
      const Module = await import(`./models/${model.provider}.js`);
      const Class = (Module.default || (Module as any)[model.provider]) as new (config: any) => Model;
      const instance = new Class(model);
      
      // save instance (needed by agents)
      ctx.models[id] = instance;

      console.log('[marvin]', 'initModels', `loaded: ${id} (${model.provider} ${model.model})`);
    } catch (err) {
      console.error('[marvin]', 'initModels', `failed: ${id} (${model.provider}${model.model})`, err);
    }
  }
}

async function initAgents(ctx: Context) {
  console.log('[marvin]', 'initAgents');

  for (const [agentId, agent] of Object.entries(ctx.config.agents)) {
    const model = ctx.models[agent.model];
    if (!model) {
      console.error('[marvin]', 'initAgents', `model not found for agent ${agentId}: ${agent.model}`);
      continue;
    }

    const tasks: Record<string, Task> = {};
    for (const [taskId, task] of Object.entries(agent.tasks)) {
      tasks[taskId] = {
        enabled: task.enabled,
        schedule: task.schedule,
        maxSteps: task.maxSteps,
        input: task.input,
        timeout: setTimeout(execTask, task.schedule, ctx, agentId, taskId),
      } as Task;

      console.log('[marvin]', 'initAgents', `agent ${agentId} task ${taskId} scheduled (${task.schedule}ms)`);
    }

    ctx.agents[agentId] = {
      enabled: agent.enabled,
      channels: agent.channels,
      model: model,
      tasks: tasks,
    } as Agent;
  }
}

async function execTask(ctx: Context, agentId: string, taskId: string) {
  const agent = ctx.agents[agentId]!;
  const task = agent.tasks[taskId];
  if (!agent || !task) return;

  if (!agent.enabled) return;
  if (!task.enabled) return;

  console.log('[marvin]', 'execTask', `${agentId}/${taskId}`);

  try {
    // TODO LLM loop (while true): send message, wait for response, run tools, check if done, repeat





    const chat: Chat = {} as Chat;

    // TOOD: load agent IDENTITY.md into chat.messages[0].role = system

    // TODO: load task.input into chat.messages[1].role = user

    // TODO: while true start

    // call the model api
    const result = await agent.model.chat(chat);

    // TODO: call tool (if needed), update chat.messages with the tool result

    // TODO: while true end






    // TODO: process result, call tools if needed (execTool)
    console.log('[marvin]', 'execTask', 'result:', JSON.stringify(result));
  } catch (err) {
    console.error('[marvin]', 'execTask', 'error:', err);
  }

  // re-schedule next execution
  task.timeout = setTimeout(execTask, task.schedule, ctx, agentId, taskId);
}

async function execReload(ctx: Context) {
  console.log('[marvin]', 'execReload');
  ctx.state = 'reloading';

  // drop in reverse order
  dropAgents(ctx);
  dropModels(ctx);
  dropChannels(ctx);
  dropServer(ctx);

  // re-init in dependency order
  await initServer(ctx);
  await initChannels(ctx);
  await initModels(ctx);
  await initAgents(ctx);

  ctx.state = 'running';
}

function dropAgents(ctx: Context) {
  console.log('[marvin]', 'dropAgents');
  for (const agent of Object.values(ctx.agents)) {
    for (const task of Object.values(agent.tasks)) {
      if (task.timeout) clearTimeout(task.timeout);
    }
  }
  ctx.agents = {};
}

function dropModels(ctx: Context) {
  console.log('[marvin]', 'dropModels');
  ctx.models = {};
}

function dropChannels(ctx: Context) {
  console.log('[marvin]', 'dropChannels');
  ctx.channels = {};
}

function dropServer(ctx: Context) {
  console.log('[marvin]', 'dropServer');
  if (ctx.server) {
    ctx.server.close();
    ctx.server = undefined;
  }
}

async function dropDaemon(ctx: Context) {
  console.log('[marvin]', 'dropDaemon');
  if (ctx.state !== 'running') return;
  ctx.state = 'stopped';

  dropAgents(ctx);
  dropModels(ctx);
  dropChannels(ctx);
  dropServer(ctx);
  dropBrowser(ctx);
}

export async function execDaemon() {
  console.log('[marvin]', 'execDaemon');

  const ctx = loadContext();

  initHandlers(ctx);
  initProject(ctx);
  await initConfig(ctx);
  initWatch(ctx);

  await initBrowser(ctx);
  await initTools(ctx);

  await initServer(ctx);
  await initChannels(ctx);
  await initModels(ctx);
  await initAgents(ctx);
}
