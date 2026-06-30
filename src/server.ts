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

    // create project/workspace folder (~/.marvin)
    const wdir = join(homedir(), '.marvin');
    if (!existsSync(wdir)) {
      mkdirSync(wdir, { recursive: true });
    }

    this.context!.home = wdir;

    // create marvin.json if missing (~/.marvin/marvin.json)
    const path = join(wdir, 'marvin.json');
    if (!existsSync(path)) {
      const config = {
        settings: { name: 'mArvIn', port: 19384, logLevel: 'info' },
        channels: {},
        models: {},
        agents: {},
      };
      writeFileSync(path, JSON.stringify(config, null, 2));
    }
  }

  initConfig(config?: Config | undefined) {
    console.log('[marvin]', 'Server.initConfig', config !== undefined);
    if (config) {
      this.context!.config = config;
      return;
    } else {
      const path = join(this.context!.home, 'marvin.json');

      config = {} as Config;

      // at this stage marvin.json MUST exist, but just in case
      if (!existsSync(path)) {
        console.error('[marvin]', 'Server.initConfig', 'Config file not found:', path);
        this.context!.config = {
          settings: { name: 'mArvIn', port: 19384, logLevel: 'info' },
          channels: {},
          models: {},
          agents: {},
        } as Config;
        return;
      }

      const data = readFileSync(path, 'utf8');
      config = tryJsonParse(data);

      this.context!.config = config!;
    }
  }

  initWatch() {
    console.log('[marvin]', 'Server.initWatch');

    const mpath = join(this.context!.home, 'marvin.json');
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

    this.context!.isDry = args.includes('--dry');
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
        instance.id = id;
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
          id: taskId,
          enabled: task.enabled,
          schedule: task.schedule,
          maxSteps: task.maxSteps,
          input: task.input,
          timeout: setTimeout(this.execTask.bind(this), task.schedule, ctx, agentId, taskId),
        } as Task;

        console.log('[marvin]', 'Server.initAgents', `agent ${agentId} task ${taskId} scheduled (${task.schedule}ms)`);
      }

      // load agent identity (IDENTITY.md or fallback)
      const identityMsg = this.loadIdentity(ctx, agentId);
      const identity = identityMsg ? identityMsg.content : constants.AGENT_SYSTEM_PROMPT;

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

  // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
  loadIdentity(ctx: Context, agentId: string): Message | null {
    console.log('[marvin]', 'Server.loadIdentity', agentId);

    // TODO: if config.agents[agentId].identity is not empty, use it, otherwise fallback to IDENTITY.md, MARVIN.md, constants.AGENT_SYSTEM_PROMPT

    const config = ctx.config.agents[agentId];

    // TODO: refactor: IDENTITY.md should be in memory on agent creation, this steps checks and parses it
    
    // TODO: fallback: IDENTITY.md -> MARVIN.md -> constants.AGENT_SYSTEM_PROMPT
    
    const path = join(ctx.home, 'agents', agentId, 'IDENTITY.md');
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf8').trim();

    // TODO: refactor: content CANNOT be empty, should have a fallback
    if (!content) return null;

    // TODO: check content if it needs strings replacements (e.g. {userName})

    return { role: 'system', content };
  }

  // load task input (user prompt for the AI loop)
  loadInput(ctx: Context, agentId: string, taskId: string): Message | null {
    console.log('[marvin]', 'Server.loadInput', agentId, taskId);

    // at this stage ctx.config.agents[agentId]! is NEVER undefined/null
    const config = ctx.config.agents[agentId]!.tasks[taskId];

    // ctx.config.agents[agentId]!.tasks[taskId].input can have 2 formats:
    // - string: "user prompt" (used directly)
    // - referece: @file:path/to/file.md (file is opened, parsed, replaced, and returned as a string)

    // TODO: refactor: input should aready be in memory on task creation, this steps checks and parses it

    const path = join(ctx.home, 'agents', agentId, 'tasks', taskId, 'input.md');
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf8').trim();
    if (!content) return null;
    return { role: 'user', content };
  }

  async sendChat(ctx: Context, agentId: string, chatId: string, input: string, maxSteps: number = constants.DEFAULT_MAX_STEPS) {
    const agent = ctx.agents[agentId];
    if (!agent) return null;

    console.log('[marvin]', 'Server.sendMessage', `${agentId}: ${input.slice(0, 100)}`);

    // TODO: get chat from cache/store using sessionId

    const chat: Chat = {id: chatId, thinking: false, messages: [] } as  Chat;

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
      console.info('[marvin]', 'Server.sendMessage', `step=${steps}`, JSON.stringify(reply));

      if (reply.stop) {
        console.warn('[marvin]', 'Server.sendMessage', `force stop at step ${steps}`);
        break;
      }

      // execute any tool calls
      if (reply.message.tools && reply.message.tools.length > 0) {
        const results: string[] = [];

        for (const tool of reply.message.tools) {
          console.log('[marvin]', 'Server.sendMessage', `executing tool: ${tool.name}`, JSON.stringify(tool.arguments));

          // TODO check for stop tool call, if found, stop the AI loop

          try {
            const args = JSON.parse(tool.arguments);
            const result = await execTool(ctx as any, tool.name, args);
            results.push(JSON.stringify(result));
          } catch (err) {
            console.error('[marvin]', 'Server.sendMessage', `tool ${tool.name} failed:`, err);
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
      console.warn('[marvin]', 'Server.sendMessage', `max steps (${maxSteps}) reached for ${agentId}`);
    }

    // TODO: more info here 
    return { content: reply?.message?.content || '', steps };
  }

  async execTask(ctx: Context, agentId: string, taskId: string) {
    const agent = ctx.agents[agentId];
    if (!agent) return;

    const task = agent.tasks[taskId];
    if (!task) return;
    if (!agent.enabled || !task.enabled) return;

    console.log('[marvin]', 'Server.execTask', `${agentId}/${taskId}`);

    const maxSteps = task.maxSteps || constants.DEFAULT_MAX_STEPS;

    // TODO: create a new session
    const sessionId = taskId + '-' + Date.now();

    const result = await this.sendChat(ctx, agentId, sessionId, task.input, maxSteps);
    if (!result) {
      console.error('[marvin]', 'Server.execTask', `agent ${agentId} not found`);
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
