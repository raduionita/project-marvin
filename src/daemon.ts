import * as http from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';

import { Browser } from 'playwright';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

import { App, Context } from './context.js';
import { tryJsonParse } from './helpers.js';
import { Config, Model, Agent, Task, Chat, Tool, Channel } from './types.js';
import { listTools } from './tools/index.js';
import { listChannels } from './channels/index.js';
import { listModels } from './models/index.js';

export class Daemon extends App {
  public context: Context = new Context();
  private server?: http.Server;
  private browser: Browser | null = null;

  get ctx() { return this.context; }

  async start(): Promise<void> {
    console.log('[marvin]', 'Daemon.start');

    this.initHandlers();
    this.initProject();
    await this.initConfig();
    this.initWatch();
    this.initFlags();
    await this.initBrowser();
    await this.execTools();
    await this.initServer();
    await this.initChannels();
    await this.initModels();
    await this.initAgents();
  }

  initHandlers() {
    const ctx = this.context;

    // SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      console.log('[marvin]', 'Daemon.initHandlers', 'SIGINT');
      process.exit(0);
    });

    // SIGTERM (kill)
    process.on('SIGTERM', () => {
      console.log('[marvin]', 'Daemon.initHandlers', 'SIGTERM');
      process.exit(0);
    });

    // unhandled rejection from promise
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[marvin]', 'Daemon.initHandlers', 'unhandledRejection:', promise, 'reason:', reason);
      // TODO: decide if the rejection should trigger a shutdown
    });

    // uncaught exception
    process.on('uncaughtException', (err) => {
      console.error('[marvin]', 'Daemon.initHandlers', 'uncaughtException:', err);
      // TODO: decide if the exception should trigger a shutdown
    });

    // process exit (graceful shutdown = stopDaemon)
    process.on('exit', async (code) => {
      console.log('[marvin]', 'Daemon.initHandlers', `process.exit(${code})`);
      await this.dropDaemon();
    });
  }

  initProject() {
    console.log('[marvin]', 'Daemon.initProject');

    // create project/workspace folder
    const wdir = join(homedir(), '.marvin');
    if (!existsSync(wdir)) {
      mkdirSync(wdir, { recursive: true });
    }

    this.context.wdir = wdir;

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

  async initConfig(config?: Config | undefined) {
    console.log('[marvin]', 'Daemon.initConfig', config !== undefined);
    if (config) {
      this.context.config = config;
      return;
    } else {
      const path = join(this.context.wdir, 'marvin.json');
  
      config = {} as Config;
  
      if (!existsSync(path)) {
        // throw error
        console.error('[marvin]', 'Daemon.initConfig', 'Config file not found:', path);
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
  
      this.context.config = config;
    }
  }

  initWatch() {
    console.log('[marvin]', 'Daemon.initWatch');

    const mpath = join(this.context.wdir, 'marvin.json');
    try {
      watch(mpath, () => {
        console.log('[marvin]', 'Daemon.initWatch', 'config file changed, reloading...');
        this.execReload();
      });
    } catch (err) {
      console.warn('[marvin]', 'Daemon.initWatch', 'config file watcher failed:', (err as Error).message);
    }
  }

  initFlags() {
    console.log('[marvin]', 'Daemon.initFlags');

    const args = process.argv.slice(2);
    if (args.includes('--reload')) {
      this.context.state = 'reloading';
    }
  }

  async initServer() {
    console.log('[marvin]', 'Daemon.initServer');

    const ctx = this.context;
    const port = ctx.config.settings.port || 19384;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const command = url.pathname.split('/')[1];

      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No command provided' }));
        return;
      }

      console.log('[marvin]', 'Daemon.initServer', `command: ${command}`);

      try {
        switch (command) {
          case 'reload':
            await this.execReload();
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
      console.error('[marvin]', 'Daemon.initServer', 'error:', err);
    });

    await new Promise<void>((resolve) => {
      ctx.server = server;
      server.listen(port, () => {
        console.log(`[marvin] HTTP Server listening on port ${port}`);
        resolve();
      });
    });
  }

  async initBrowser() {
    console.log('[marvin]', 'Daemon.initBrowser');

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

    this.context.browser = browser;
  }

  async dropBrowser() {
    console.log('[marvin]', 'Daemon.dropBrowser');
    if (this.context.browser) {
      try {
        await this.context.browser.close();
      } catch (err) {
        console.error('[marvin]', 'Daemon.dropBrowser', 'error:', err);
      }
      this.context.browser = null;
    }
  }

  async execTools() {
    console.log('[marvin]', 'Daemon.execTools');

    const ctx = this.context;
    const files = listTools(this).map(f => f.replace('.ts', ''));
    for (const file of files) {
      const name = file;
      try {
        const Module = await import(`./tools/${name}.js`);
        const Class = Module.default || (Module as any)[name.charAt(0).toUpperCase() + name.slice(1)];
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.warn('[marvin]', 'Daemon.execTools', `${file} does not export a Tool class, skipping`);
          continue;
        }
        const instance = new (Class as new (ctx: Context) => Tool)(ctx);
        if (name !== instance.name()) {
          console.warn('[marvin]', 'Daemon.execTools', `${file}: module name "${name}" does not match tool name "${instance.name()}", skipping`);
          continue;
        }
        ctx.tools[instance.name()] = instance;
        console.log('[marvin]', 'Daemon.execTools', `loaded: ${instance.name()}`);
      } catch (err) {
        console.error('[marvin]', 'Daemon.execTools', `failed to load ${file}:`, err);
      }
    }
  }

  async initChannels() {
    console.log('[marvin]', 'Daemon.initChannels');

    const files = listChannels(this).map(f => f.replace('.ts', ''));
    for (const [id, config] of Object.entries(this.ctx.config.channels) as [string, Config['channels'][string]][]) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        console.warn('[marvin]', 'Daemon.initChannels', `no file for file "${file}", skipping ${id}`);
        continue;
      }

      try {
        const Module = await import(`./channels/${file}.js`);
        const Class = Module.default || (Module as any)[file.charAt(0).toUpperCase() + file.slice(1)];
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.warn('[marvin]', 'Daemon.initChannels', `${file} does not export a Channel class, skipping ${id}`);
          continue;
        }
        const instance = new Class();
        await instance.attach(this);
        this.ctx.channels[id] = instance;
        console.log('[marvin]', 'Daemon.initChannels', `loaded: ${id}`);
      } catch (err) {
        console.error('[marvin]', 'Daemon.initChannels', `failed to load ${id}:`, err);
      }
    }
  }

  async initModels() {
    console.log('[marvin]', 'Daemon.initModels');

    const ctx = this.context;
    const files = listModels(this).map(f => f.replace('.ts', ''))
    for (const [id, model] of Object.entries(ctx.config.models)) {
      if (!model.enabled) continue;

      const provider = model.provider;
      const file = files.find(f => f === provider);
      if (!file) {
        console.warn('[marvin]', 'Daemon.initModels', `no file for provider "${provider}", skipping ${id}`);
        continue;
      }

      try {
        const Module = await import(`./models/${provider}.js`);
        const Class = (Module.default || (Module as any)[provider.charAt(0).toUpperCase() + provider.slice(1)]) as new (config: any) => Model;
        const instance = new Class(model);

        // save instance (needed by agents)
        ctx.models[id] = instance;

        console.log('[marvin]', 'Daemon.initModels', `loaded: ${id} (${provider} ${model.model})`);
      } catch (err) {
        console.error('[marvin]', 'Daemon.initModels', `failed to load ${id}:`, err);
      }
    }
  }

  async initAgents() {
    console.log('[marvin]', 'Daemon.initAgents');

    const ctx = this.context;
    for (const [agentId, agent] of Object.entries(ctx.config.agents)) {
      const model = ctx.models[agent.model];
      if (!model) {
        console.error('[marvin]', 'Daemon.initAgents', `model not found for agent ${agentId}: ${agent.model}`);
        continue;
      }

      const tasks: Record<string, Task> = {};
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        tasks[taskId] = {
          enabled: task.enabled,
          schedule: task.schedule,
          maxSteps: task.maxSteps,
          input: task.input,
          timeout: setTimeout(this.execTask.bind(this), task.schedule, ctx, agentId, taskId),
        } as Task;

        console.log('[marvin]', 'Daemon.initAgents', `agent ${agentId} task ${taskId} scheduled (${task.schedule}ms)`);
      }

      ctx.agents[agentId] = {
        enabled: agent.enabled,
        channels: agent.channels,
        model: model,
        tasks: tasks,
      } as Agent;
    }
  }

  async execTask(ctx: Context, agentId: string, taskId: string) {
    const agent = ctx.agents[agentId]!;
    const task = agent.tasks[taskId];
    if (!agent || !task) return;

    if (!agent.enabled) return;
    if (!task.enabled) return;

    console.log('[marvin]', 'Daemon.execTask', `${agentId}/${taskId}`);

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
      console.log('[marvin]', 'Daemon.execTask', 'result:', JSON.stringify(result));
    } catch (err) {
      console.error('[marvin]', 'Daemon.execTask', 'error:', err);
    }

    // re-schedule next execution
    task.timeout = setTimeout(this.execTask.bind(this), task.schedule, ctx, agentId, taskId);
  }

  async execReload() {
    console.log('[marvin]', 'Daemon.execReload');
    this.context.state = 'reloading';

    // drop in reverse order
    this.dropAgents();
    this.dropModels();
    this.dropChannels();
    this.dropServer();

    // re-init in dependency order
    await this.initServer();
    await this.initChannels();
    await this.initModels();
    await this.initAgents();

    this.context.state = 'running';
  }

  dropAgents() {
    console.log('[marvin]', 'Daemon.dropAgents');
    const ctx = this.context;
    for (const agent of Object.values(ctx.agents)) {
      for (const task of Object.values(agent.tasks)) {
        if (task.timeout) clearTimeout(task.timeout);
      }
    }
    ctx.agents = {};
  }

  dropModels() {
    console.log('[marvin]', 'Daemon.dropModels');
    this.context.models = {};
  }

  // will detach and delete ALL channels from the context
  dropChannels() {
    console.log('[marvin]', 'Daemon.dropChannels');
    const ctx = this.context;
    for (const channel of Object.values(ctx.channels)) {
      try {
        channel.detach();
      } catch (err) {
        console.error('[marvin]', 'Daemon.dropChannels', `error detaching channel:`, err);
      }
    }
    ctx.channels = {};
  }

  // will detach and delete the channel from the context
  dropChannel(id: string) {
    console.log('[marvin]', 'Daemon.dropChannel', id);
    const ctx = this.context;
    if (ctx.channels[id]) {
      try {
        ctx.channels[id].detach();
      } catch (err) {
        console.error('[marvin]', 'Daemon.dropChannel', `error detaching channel:`, err);
      }
      delete ctx.channels[id];
    }
  }

  // will close the server and set to undefined, you will need initServer() to re-open it
  dropServer() {
    console.log('[marvin]', 'Daemon.dropServer');
    const ctx = this.context;
    if (ctx.server) {
      ctx.server.close();
      ctx.server = undefined;
    }
  }

  // will drop all the resources from the context
  async dropDaemon() {
    console.log('[marvin]', 'Daemon.dropDaemon');
    if (this.context.state !== 'running') return;
    this.context.state = 'stopped';

    this.dropAgents();
    this.dropModels();
    this.dropChannels();
    this.dropServer();
    await this.dropBrowser();
  }
}
