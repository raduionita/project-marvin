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
import { App, Config, Model, Agent, Task, Chat, Tool, Channel, Message } from './types.js';
import { listTools } from './tools/index.js';
import { listChannels } from './channels/index.js';
import { listModels } from './models/index.js';

export class Server extends App {
  // initialize the app/server and its internal systems
  async init(): Promise<void> {
    console.log('[marvin]', 'Server.init');

    this.initContext();
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

    if (this.context!.state !== 'running') return;
    this.context!.state = 'stopped';

    this.dropAgents();
    this.dropModels();
    await this.dropChannels();
    this.dropHttp();
    await this.dropBrowser();
  }

  initContext() {
    console.log('[marvin]', 'Server.initContext');
    this.context = new Context();
    this.context!.server = this;
  }

  initHandlers() {
    const ctx = this.context!;

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

  initProject() {
    console.log('[marvin]', 'Server.initProject');

    // create project/workspace folder
    const wdir = join(homedir(), '.marvin');
    if (!existsSync(wdir)) {
      mkdirSync(wdir, { recursive: true });
    }

    this.context!.wdir = wdir;

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

  initConfig(config?: Config | undefined) {
    console.log('[marvin]', 'Server.initConfig', config !== undefined);
    if (config) {
      this.context!.config = config;
      return;
    } else {
      const path = join(this.context!.wdir, 'marvin.json');

      config = {} as Config;

      if (!existsSync(path)) {
        // throw error
        console.error('[marvin]', 'Server.initConfig', 'Config file not found:', path);
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

      this.context!.config = config;
    }
  }

  initWatch() {
    console.log('[marvin]', 'Server.initWatch');

    const mpath = join(this.context!.wdir, 'marvin.json');
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

    const args = process.argv.slice(2);
    if (args.includes('--reload')) {
      this.context!.state = 'reloading';
    }
  }

  async initHttp() {
    console.log('[marvin]', 'Server.initHttp');

    const ctx = this.context!;
    const port = ctx.config.settings.port || 19384;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const command = url.pathname.split('/')[1];

      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No command provided' }));
        return;
      }

      console.log('[marvin]', 'Server.initHttp', `command: ${command}`);

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

    this.context!.browser = browser;
  }

  async dropBrowser() {
    console.log('[marvin]', 'Server.dropBrowser');
    if (this.context!.browser) {
      try {
        await this.context!.browser.close();
      } catch (err) {
        console.error('[marvin]', 'Server.dropBrowser', 'error:', err);
      }
      this.context!.browser = null;
    }
  }

  async initTools() {
    console.log('[marvin]', 'Server.initTools');

    const ctx = this.context!;
    const files = listTools(this.context!).map(f => f.replace('.ts', ''));
    for (const file of files) {
      const name = file;
      try {
        const Module = await import(`./tools/${name}.js`);
        const Class = Module.default || (Module as any)[name.charAt(0).toUpperCase() + name.slice(1)];
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.warn('[marvin]', 'Server.initTools', `${file} does not export a Tool class, skipping`);
          continue;
        }
        const instance = new (Class as new (ctx: Context) => Tool)(ctx);
        if (name !== instance.name()) {
          console.warn('[marvin]', 'Server.initTools', `${file}: module name "${name}" does not match tool name "${instance.name()}", skipping`);
          continue;
        }
        ctx.tools[instance.name()] = instance;
        console.log('[marvin]', 'Server.initTools', `loaded: ${instance.name()}`);
      } catch (err) {
        console.error('[marvin]', 'Server.initTools', `failed to load ${file}:`, err);
      }
    }
  }

  async initChannels() {
    console.log('[marvin]', 'Server.initChannels');

    const files = listChannels(this.context!).map(f => f.replace('.ts', ''));
    for (const [id, config] of Object.entries(this.context!.config.channels) as [string, Config['channels'][string]][]) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        console.warn('[marvin]', 'Server.initChannels', `no file for file "${file}", skipping ${id}`);
        continue;
      }

      try {
        const Module = await import(`./channels/${file}.js`);
        const Class = Module.default || (Module as any)[file.charAt(0).toUpperCase() + file.slice(1)];
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.warn('[marvin]', 'Server.initChannels', `${file} does not export a Channel class, skipping ${id}`);
          continue;
        }
        const instance = new Class();
        await instance.init(this);
        this.context!.channels[id] = instance;
        console.log('[marvin]', 'Server.initChannels', `loaded: ${id}`);
      } catch (err) {
        console.error('[marvin]', 'Server.initChannels', `failed to load ${id}:`, err);
      }
    }
  }

  async initModels() {
    console.log('[marvin]', 'Server.initModels');

    const ctx = this.context!;
    const files = listModels(this).map(f => f.replace('.ts', ''))
    for (const [id, model] of Object.entries(ctx.config.models)) {
      if (!model.enabled) continue;

      const provider = model.provider;
      const file = files.find(f => f === provider);
      if (!file) {
        console.warn('[marvin]', 'Server.initModels', `no file for provider "${provider}", skipping ${id}`);
        continue;
      }

      try {
        const Module = await import(`./models/${provider}.js`);
        const Class = (Module.default || (Module as any)[provider.charAt(0).toUpperCase() + provider.slice(1)]) as new (config: any) => Model;
        const instance = new Class(model);

        // save instance (needed by agents)
        ctx.models[id] = instance;

        console.log('[marvin]', 'Server.initModels', `loaded: ${id} (${provider} ${model.model})`);
      } catch (err) {
        console.error('[marvin]', 'Server.initModels', `failed to load ${id}:`, err);
      }
    }
  }

  async initAgents() {
    console.log('[marvin]', 'Server.initAgents');

    const ctx = this.context!;
    for (const [agentId, agent] of Object.entries(ctx.config.agents)) {
      const model = ctx.models[agent.model];
      if (!model) {
        console.error('[marvin]', 'Server.initAgents', `model not found for agent ${agentId}: ${agent.model}`);
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

        console.log('[marvin]', 'Server.initAgents', `agent ${agentId} task ${taskId} scheduled (${task.schedule}ms)`);
      }

      ctx.agents[agentId] = {
        enabled: agent.enabled,
        channels: agent.channels,
        model: model,
        tasks: tasks,
      } as Agent;
    }
  }

  // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
  loadIdentity(ctx: Context, agentId: string): Message | null {

    // TODO: if config.agents[agentId].identity is not empty, use it, otherwise fallback to IDENTITY.md, MARVIN.md, constants.AGENT_SYSTEM_PROMPT

    const config = ctx.config.agents[agentId];

    // TODO: refactor: IDENTITY.md should be in memory on agent creation, this steps checks and parses it
    
    // TODO: fallback: IDENTITY.md -> MARVIN.md -> constants.AGENT_SYSTEM_PROMPT
    
    const path = join(ctx.wdir, 'agents', agentId, 'IDENTITY.md');
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf8').trim();

    // TODO: refactor: content CANNOT be empty, should have a fallback
    if (!content) return null;

    // TODO: check content if it needs strings replacements (e.g. {userName})

    return { role: 'system', content };
  }

  // load task input (user prompt for the AI loop)
  loadInput(ctx: Context, agentId: string, taskId: string): Message | null {
    // at this stage ctx.config.agents[agentId]! is NEVER undefined/null
    const config = ctx.config.agents[agentId]!.tasks[taskId];

    // ctx.config.agents[agentId]!.tasks[taskId].input can have 2 formats:
    // - string: "user prompt" (used directly)
    // - referece: @file:path/to/file.md (file is opened, parsed, replaced, and returned as a string)

    // TODO: refactor: input should aready be in memory on task creation, this steps checks and parses it

    const path = join(ctx.wdir, 'agents', agentId, 'tasks', taskId, 'input.md');
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf8').trim();
    if (!content) return null;
    return { role: 'user', content };
  }

  async execTask(ctx: Context, agentId: string, taskId: string) {
    const agent = ctx.agents[agentId];
    if (!agent) return;

    const task = agent.tasks[taskId];
    if (!task) return;
    if (!agent.enabled || !task.enabled) return;

    console.log('[marvin]', 'Server.execTask', `${agentId}/${taskId}`);

    // TODO: need to enforce a result type
    let result: any;

    try {
      // TODO: decide if thinking is enabled or disabled
      const chat: Chat = { thinking: false, messages: [] };
      
      // load agent IDENTITY.md as system message
      chat.messages.push({ role: 'system', content: agent.identity });

      // load task input as user message
      chat.messages.push({ role: 'user', content: task.input });
      
      // AI loop: call model, execute tool calls, repeat until done
      let steps = 0;
      while (steps < task.maxSteps) {
        steps++;

        // TODO: Model.chat() NEEDS to return a proper (provider agnostic) result type, or a custom type that supports ALL providers
        result = await agent.model.chat(chat);

        // TODO: trim result, this can be really big
        console.info('[marvin]', 'Server.execTask', `step ${steps}`, JSON.stringify(result));

        // execute any tool calls
        if (result.message.tools && result.message.tools.length > 0) {
          const results: string[] = [];

          for (const tool of result.message.tools) {
            console.log('[marvin]', 'Server.execTask', `executing tool: ${tool.name}`, JSON.stringify(tool.args));

            // TODO: NEED stop tool = if stop exit while loop, reply/report to the user through the channel(s)

            try {
              const r = await execTool(ctx as any, tool.name, typeof tool.args === 'string' ? JSON.parse(tool.args) : tool.args);
              results.push(JSON.stringify(r));
            } catch (err) {
              console.error('[marvin]', 'Server.execTask', `tool ${tool.name} failed:`, err);
              results.push(`Error: ${(err as Error).message}`);
            }
          }

          // add tool call to chat history
          chat.messages.push({ role: 'tool', content: results.join('\n'), tool_call_id: result.message.tools[0].id });
        }

        // if model produced content without pending tool calls, we're done
        if (result.message.content && (!result.message.tools || result.message.tools.length === 0)) {
          break;
        }
      }

      // warn if max steps reached
      if (steps >= task.maxSteps) {
        console.warn('[marvin]', 'Server.execTask', `max steps (${task.maxSteps}) reached for ${agentId}/${taskId}`);
      }

      // send final result through configured channels
      const content = result?.message?.content || '';
      for (const [channelId, groupId] of Object.entries(agent.channels)) {
        const channel = ctx.channels[channelId];

        // verify channel exists, warn if not, then skip
        if (!channel) {
          console.warn('[marvin]', 'Server.execTask', `channel ${channelId} not found, skipping`);
          continue;
        }

        // try to send, log error if failed, continue
        try {
          await channel.send({ role: 'assistant', content: content, group: groupId } as Message);
        } catch (err) {
          console.error('[marvin]', 'Server.execTask', `channel ${channelId} send failed:`, err);
        }
      }
    } catch (err) {
      console.error('[marvin]', 'Server.execTask', 'error:', err);
    }

    // re-schedule next execution
    task.timeout = setTimeout(this.execTask.bind(this), task.schedule, ctx, agentId, taskId);
  }

  async execReload() {
    console.log('[marvin]', 'Server.execReload');
    this.context!.state = 'reloading';

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

    this.context!.state = 'running';
  }

  dropAgents() {
    console.log('[marvin]', 'Server.dropAgents');
    const ctx = this.context!;
    for (const agent of Object.values(ctx.agents)) {
      for (const task of Object.values(agent.tasks)) {
        if (task.timeout) clearTimeout(task.timeout);
      }
    }
    ctx.agents = {};
  }

  dropModels() {
    console.log('[marvin]', 'Server.dropModels');
    this.context!.models = {};
  }

  // will detach and delete ALL channels from the context
  async dropChannels() {
    console.log('[marvin]', 'Server.dropChannels');
    const ctx = this.context!;
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
  dropChannel(id: string) {
    console.log('[marvin]', 'Server.dropChannel', id);
    const ctx = this.context!;
    if (ctx.channels[id]) {
      try {
        ctx.channels[id].drop();
      } catch (err) {
        console.error('[marvin]', 'Server.dropChannel', `error detaching channel:`, err);
      }
      delete ctx.channels[id];
    }
  }

  // will close the server and set to undefined, you will need initHttp() to re-open it
  dropHttp() {
    console.log('[marvin]', 'Server.dropHttp');
    if (this.context!.http) {
      this.context!.http.close();
      this.context!.http = undefined;
    }
  }
}
