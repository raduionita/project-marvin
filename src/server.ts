import * as http from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';

import { Browser } from 'playwright';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

import { Context } from './context.js';
import { tryJsonParse } from './helpers.js';
import { execTool } from './tools/index.js';
import { App, Config, Model, Agent, Task, Chat, Tool, Channel, Message, Reply } from './types.js';
import * as constants from './constants.js';
import { listTools } from './tools/index.js';
import { listChannels } from './channels/index.js';
import { listModels } from './models/index.js';

export class Server extends App {
  // initialize the app/server and its internal systems
  async init(): Promise<void> {
    console.log('[marvin]', 'Server.init');

    this.initHandlers();
    this.initProject();
    this.initConfig();
    this.initWatch();
    this.initFlags();
    await this.initBrowser();
    await this.initTools();
    await this.initHttp();
    await this.initChannels();
    await this.initModels();
    await this.initAgents();
  }

  // will drop all the resources from the context
  async drop() {
    console.log('[marvin]', 'Server.drop');

    if (this.ctx!.state !== 'running') return;
    this.ctx!.state = 'stopped';

    this.dropAgents();
    this.dropModels();
    await this.dropChannels();
    await this.dropHttp();
    await this.dropBrowser();
  }

  // sets up handlers for SIGINT, SIGTERM, and unhandledRejection, uncaughtException, exit
  initHandlers() {
    // SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      console.log('[marvin]', 'Server.initHandlers', 'SIGINT');
      process.exit(0);
    });

    // SIGTERM (kill)
    process.on('SIGTERM', () => {
      console.log('[marvin]', 'Server.initHandlers', 'SIGTERM');
      process.exit(0);
    });

    // unhandled rejection from promise
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[marvin]', 'Server.initHandlers', 'unhandledRejection:', promise, 'reason:', reason);
      // TODO: decide if the rejection should trigger a shutdown
    });

    // uncaught exception
    process.on('uncaughtException', (err) => {
      console.error('[marvin]', 'Server.initHandlers', 'uncaughtException:', err);
      // TODO: decide if the exception should trigger a shutdown
    });

    // process exit (graceful shutdown = stopServer)
    process.on('exit', async (code) => {
      console.log('[marvin]', 'Server.initHandlers', `process.exit(${code})`);
      await this.drop();
    });
  }

  // create ~/.marvin folder and required files
  initProject() {
    console.log('[marvin]', 'Server.initProject');

    // set root to the app folder (where package.json lives)
    this.ctx!.root = import.meta.url.replace('file://', '').replace(/\\/g, '/').replace(/\/src\/server\.ts$/, '');

    // create project/workspace folder (~/.marvin)
    const home = join(homedir(), '.marvin');
    if (!existsSync(home)) {
      mkdirSync(home, { recursive: true });
    }

    // set home (~/.marvin)
    this.ctx!.home = home;

    // agents folder (~/.marvin/agents)
    const apath = join(home, 'agents');
    if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(home, 'MARVIN.md');
    if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const path = join(home, 'marvin.json');
    if (!existsSync(path)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(path, JSON.stringify(config, null, 2));
    }
  }

  initConfig(config?: Config | undefined) {
    console.log('[marvin]', 'Server.initConfig', config !== undefined);
    if (config) {
      this.ctx!.config = config;
      return;
    }

    const path = join(this.ctx!.home, 'marvin.json');

    config = {} as Config;

    // at this stage marvin.json MUST exist, but just in case
    if (!existsSync(path)) {
      console.error('[marvin]', 'Server.initConfig', 'Config file not found:', path);
      this.ctx!.config = constants.DEFAULT_CONFIG as Config;
      return;
    }

    const data = readFileSync(path, 'utf8');
    config = tryJsonParse(data);

    this.ctx!.config = config!;
  }

  initWatch() {
    console.log('[marvin]', 'Server.initWatch');

    const mpath = join(this.ctx!.home, 'marvin.json');
    try {
      let w = watch(mpath, () => {
        console.log('[marvin]', 'Server.initWatch', 'config file changed, reloading...');
        this.execReload();
      });
      w.close();
    } catch (err) {
      console.warn('[marvin]', 'Server.initWatch', 'config file watcher failed:', (err as Error).message);
    }
  }

  initFlags() {
    console.log('[marvin]', 'Server.initFlags');
    // const args = process.argv.slice(2);
  }

  async initHttp() {
    console.log('[marvin]', 'Server.initHttp');

    const ctx = this.ctx!;
    const port = ctx.config.settings.port || 7331;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const command = url.pathname.split('/')[1];

      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No command provided' }));
        return;
      }

      const verb = req.method || 'GET';

      console.log('[marvin]', 'Server.initHttp', `command: ${command}`);

      try {
        switch (command) {
          case '_health':
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, data: {} }));
            break;
          case 'reload':
            await this.execReload();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, data: {} }));
            break;
          case 'status':
            // TODO: add more info: models, channels, agents, tools
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, data: { state: this.ctx!.state } }));
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
      console.error('[marvin]', 'Server.initHttp', 'error:', err);
    });

    await new Promise<void>((resolve) => {
      ctx.http = server;
      server.listen(port, () => {
        console.log(`[marvin] HTTP Server listening on port ${port}`);
        resolve();
      });
    });
  }

  async initBrowser() {
    console.log('[marvin]', 'Server.initBrowser');

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

    this.ctx!.browser = browser;
  }

  async initTools() {
    console.log('[marvin]', 'Server.initTools');

    const files = listTools(this.ctx).map(f => f.replace('.ts', ''));
    for (const file of files) {
      const name = file;
      try {
        const Module = await import(`./tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.warn('[marvin]', 'Server.initTools', `${file} does not export a Tool class, skipping`);
          continue;
        }
        // register instance of Tool
        const instance = new Class(this.ctx);
        this.ctx.tools[instance.name()] = instance;
        console.log('[marvin]', 'Server.initTools', `loaded: ${instance.name()}`);
      } catch (err) {
        console.error('[marvin]', 'Server.initTools', `failed to load ${file}:`, err);
      }
    }
  }

  async initChannels() {
    console.log('[marvin]', 'Server.initChannels');

    const files = listChannels(this.ctx!).map(f => f.replace('.ts', ''));
    for (const [id, config] of Object.entries(this.ctx!.config.channels) as [string, Config['channels'][string]][]) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        console.warn('[marvin]', 'Server.initChannels', `no file for file "${file}", skipping ${id}`);
        continue;
      }

      try {
        const Module = await import(`./channels/${file}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.warn('[marvin]', 'Server.initChannels', `${file} does not export a Channel class, skipping ${id}`);
          continue;
        }
        // register instance of Channel 
        const instance = new Class(this.ctx);
        await instance.init();
        this.ctx.channels[id] = instance;
        console.log('[marvin]', 'Server.initChannels', `loaded: ${id}`);
      } catch (err) {
        console.error('[marvin]', 'Server.initChannels', `failed to load ${id}:`, err);
      }
    }
  }

  async initModels() {
    console.log('[marvin]', 'Server.initModels');

    const ctx = this.ctx!;

    // config models
    const files = listModels(this).map(f => f.replace('.ts', ''))
    for (const [modelId, model] of Object.entries(ctx.config.models)) {
      if (!model.enabled) continue;

      const provider = model.provider;

      const file = files.find(f => f === provider);
      if (!file) {
        console.warn('[marvin]', 'Server.initModels', `no file for provider "${provider}", skipping ${modelId}`);
        continue;
      }

      try {
        // import the model provider
        const Module = await import(`./models/${provider}.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          console.error('[marvin]', 'Server.initModels', `${modelId} does not export a Model class, skipping`);
          continue;
        }
        
        // save instance (needed by agents)
        const instance = new Class(model);
        ctx.models[modelId] = instance;

        console.log('[marvin]', 'Server.initModels', `loaded: ${modelId} (${provider} ${model.model})`);
      } catch (err) {
        console.error('[marvin]', 'Server.initModels', `failed to load ${modelId}:`, err);
      }
    }

    // fallback model (if no other model is found)
    if (Object.keys(ctx.models).length === 0) {
      const modelId = 'fallback';

      try {
        // import the model provider
        const Module = await import(`./models/fallback.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          console.error('[marvin]', 'Server.initModels', `${modelId} does not export a Model class!`);
          process.exit(1);
        }

        const instance = new Class({provider: 'fallback', model: 'fallback'});
        ctx.models[modelId] = instance;

        // warn because fallback model is not a good idea, and does NOTHING
        console.warn('[marvin]', 'Server.initModels', `loaded: ${modelId}`);
      } catch (err) {
        console.error('[marvin]', 'Server.initModels', `failed to load ${modelId}:`, err);
      }
    }
  }

  async initAgents() {
    console.log('[marvin]', 'Server.initAgents');

    const ctx = this.ctx!;

    // type: orchestrator/supervisor
    const agentId = ctx.config.settings.name;
    
    // model: default or first
    const model = Object.values(ctx.models).find(m => m.enabled && m.default) || ctx.models[Object.keys(ctx.models)[0] as string]!;

    // load agent system prompt (~/.marvin/IDENTITY.md)
    let identity = readFileSync(join(ctx.home, 'MARVIN.md'), 'utf8').trim();
    if (!identity) {
      console.warn('[marvin]', 'Server.initAgents', `no MARVIN.md found for agent ${agentId}, using default`);
      identity = constants.MARVIN_MD;
    }
    
    // add ochestrator agent
    ctx.agents[agentId] = {
      id: agentId,
      enabled: true,
      identity: identity,
      channels: {},
      model: model,
      tasks: {},
    } as Agent;

    // type: agent
    for (const [agentId, agent] of Object.entries(ctx.config.agents)) {
      const model = ctx.models[agent.model || ''];
      if (!model) {
        console.error('[marvin]', 'Server.initAgents', `model not found for agent ${agentId}: ${agent.model}`);
        continue;
      }

      const tasks: Record<string, Task> = {};
      for (const [taskId, task] of Object.entries(agent.tasks || {})) {
        let enabled = task.enabled;

        // default input to task.input as string/prompt
        let input = task.input;

        // first try to load task input from file
        if (existsSync(join(ctx.home, 'agents', agentId, 'tasks', `${taskId.toUpperCase()}.md`))) {
          input = readFileSync(join(ctx.home, 'agents', agentId, 'tasks', `${taskId.toUpperCase()}.md`), 'utf8').trim();
        } else if (existsSync(join(ctx.home, 'agents', agentId, 'tasks', `${taskId}.md`))) {
          input = readFileSync(join(ctx.home, 'agents', agentId, 'tasks', `${taskId}.md`), 'utf8').trim();
        }

        if (!input) {
          console.warn('[marvin]', 'Server.initAgents', `no input found for task ${taskId}, disabling`);
          enabled = false;
        }

        tasks[taskId] = {
          id: taskId,
          enabled: enabled,
          schedule: task.schedule,
          maxSteps: task.maxSteps,
          input: input,
          timeout: setTimeout(this.execTask.bind(this), task.schedule, ctx, agentId, taskId),
        } as Task;

        console.log('[marvin]', 'Server.initAgents', `agent ${agentId} task ${taskId} scheduled (${task.schedule}ms)`);
      }

      // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
      let identity = readFileSync(join(ctx.home, 'agents', agentId, 'IDENTITY.md'), 'utf8').trim();
      if (!identity) {
        console.warn('[marvin]', 'Server.initAgents', `no IDENTITY.md found for agent ${agentId}, using default`);
        identity = constants.IDENTITY_MD;
      }

      ctx.agents[agentId] = {
        id: agentId,
        enabled: agent.enabled,
        identity: identity,
        channels: agent.channels,
        model: model,
        tasks: tasks,
      } as Agent;
    }
  }

  async sendChat(ctx: Context, chatId: string, agentId: string, input: string, maxSteps: number = constants.DEFAULT_MAX_STEPS) {
    const agent = ctx.agents[agentId]!;

    console.log('[marvin]', 'Server.sendChat', `${agentId}: ${input.slice(0, 100)}`);

    // TODO: get chat from cache/store using sessionId

    const chat = { id: chatId, thinking: false, messages: [] } as Chat;

    // load agent IDENTITY.md as system message
    chat.messages.push({ role: 'system', content: agent.identity });

    // load task input as user message
    chat.messages.push({ role: 'user', content: input });

    // TODO this needs a type, Model.chat should return a proper Reply/Response/Result type
    let reply: Reply;

    // AI loop: call model, execute tool calls, repeat until done
    let steps = -1;
    do {
      steps++;

      // core of the AI loop: call model, execute tool calls, repeat until done
      reply = await agent.model.sendChat(chat);

      // trim result, this can be really big
      console.info('[marvin]', 'Server.sendChat', `step=${steps}`, JSON.stringify(reply));

      if (reply.stop) {
        console.warn('[marvin]', 'Server.sendChat', `force stop at step ${steps}`);
        break;
      }

      // execute any tool calls
      if (reply.message.tools && reply.message.tools.length > 0) {
        const results: string[] = [];

        for (const tool of reply.message.tools) {
          console.log('[marvin]', 'Server.sendChat', `executing tool: ${tool.name}`, JSON.stringify(tool.arguments));

          // TODO check for stop tool call, if found, stop the AI loop

          try {
            const args = JSON.parse(tool.arguments);
            const result = await execTool(ctx as any, tool.name, args);
            results.push(JSON.stringify(result));
          } catch (err) {
            console.error('[marvin]', 'Server.sendChat', `tool ${tool.name} failed:`, err);
            results.push(`Error: ${(err as Error).message}`);
          }
        }

        // TODO: all this tool exec logic needs to be checked and tested (unit)

        // add tool call to chat history
        chat.messages.push({ role: 'tool', content: results.join('\n'), toolId: reply.message.tools[0]?.id });
      }

      // if model produced content without pending tool calls, we're done
      if (reply.message.content && (!reply.message.tools || reply.message.tools.length === 0)) {
        break;
      }
    } while (steps < maxSteps - 1);

    // warn if max steps reached
    if (steps >= maxSteps) {
      console.warn('[marvin]', 'Server.sendChat', `max steps (${maxSteps}) reached for ${agentId}`);
    }

    // TODO: more info here 
    return { content: reply?.message?.content || '', steps };
  }

  async execTask(ctx: Context, agentId: string, taskId: string) {
    const agent = ctx.agents[agentId]!;
    const task = agent.tasks[taskId]!;

    if (!agent.enabled || !task.enabled) return;

    console.log('[marvin]', 'Server.execTask', `${agentId}/${taskId}`);

    const maxSteps = task.maxSteps || constants.DEFAULT_MAX_STEPS;

    // TODO: create a new chat or use it to retrieve the chat from cache
    const chatId = `task-${taskId}-${Date.now()}`;

    const result = await this.sendChat(ctx, agentId, chatId, task.input, maxSteps);
    if (!result) {
      console.error('[marvin]', 'Server.execTask', `no result from sendChat for agent ${agentId}`);
      return;
    }

    const { content, steps } = result;

    // send final result through configured channels
    for (const [channelId, groupId] of Object.entries(agent.channels)) {
      const channel = ctx.channels[channelId];

      // verify channel exists, warn if not, then skip
      if (!channel) {
        console.warn('[marvin]', 'Server.execTask', `channel ${channelId} not found, skipping`);
        continue;
      }

      // try to send, log error if failed, continue
      try {
        await channel.sendMessage({ role: 'assistant', content: content, channel: groupId } as Message);
      } catch (err) {
        console.error('[marvin]', 'Server.execTask', `channel ${channelId} send failed:`, err);
      }
    }

    // re-schedule next execution
    task.timeout = setTimeout(this.execTask.bind(this), task.schedule, ctx, agentId, taskId);
  }

  async execReload() {
    console.log('[marvin]', 'Server.execReload');
    this.ctx!.state = 'reloading';

    // drop in reverse order
    this.dropAgents();
    this.dropModels();
    this.dropChannels();
    this.dropHttp();

    // re-init in dependency order
    await this.initHttp();
    await this.initChannels();
    await this.initModels();
    await this.initAgents();

    this.ctx!.state = 'running';
  }

  dropAgents() {
    console.log('[marvin]', 'Server.dropAgents');
    const ctx = this.ctx!;
    for (const agent of Object.values(ctx.agents)) {
      for (const task of Object.values(agent.tasks)) {
        if (task.timeout) clearTimeout(task.timeout);
      }
    }
    ctx.agents = {};
  }

  dropModels() {
    console.log('[marvin]', 'Server.dropModels');
    this.ctx!.models = {};
  }

  // will detach and delete ALL channels from the context
  async dropChannels() {
    console.log('[marvin]', 'Server.dropChannels');
    const ctx = this.ctx!;
    for (const channel of Object.values(ctx.channels)) {
      try {
        await channel.drop();
      } catch (err) {
        console.error('[marvin]', 'Server.dropChannels', `error detaching channel:`, err);
      }
    }
    ctx.channels = {};
  }

  // will detach and delete the channel from the context
  async dropChannel(id: string) {
    console.log('[marvin]', 'Server.dropChannel', id);
    const ctx = this.ctx!;
    if (ctx.channels[id]) {
      try {
        ctx.channels[id].drop();
      } catch (err) {
        console.error('[marvin]', 'Server.dropChannel', `error detaching channel:`, err);
      }
      delete ctx.channels[id];
    }
  }

  async dropBrowser() {
    console.log('[marvin]', 'Server.dropBrowser');
    if (this.ctx!.browser) {
      try {
        await this.ctx!.browser.close();
      } catch (err) {
        console.error('[marvin]', 'Server.dropBrowser', 'error:', err);
      }
      this.ctx!.browser = null;
    }
  }

  // will close the server and set to undefined, you will need initHttp() to re-open it
  async dropHttp() {
    console.log('[marvin]', 'Server.dropHttp');
    return new Promise<void>((resolve) => {
      if (this.ctx!.http) {
        this.ctx!.http.close(function (error?: Error|undefined) {
          if (error) {
            console.error('[marvin]', 'Server.dropHttp', 'error:', error);
          }
          resolve();
        });
        this.ctx!.http = undefined;
      } else {
        resolve();
      }
    });
  }
}
