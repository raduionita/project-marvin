
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';

import { Context, Command, Config, System, Model, Agent, Task, Chat, Tool, Channel, Message, Reply  } from '../types.js';
import { tryJsonParse } from '../helpers.js';
import * as constants from '../constants.js';
import { listSystems } from '../systems/index.js';
import { listTools, execTool } from '../tools/index.js';
import { listChannels } from '../channels/index.js';
import { listModels } from '../models/index.js';

// `marvin serve [help] [--dry]`
export default class ServeCommand extends Command {
  // initialize the app/server and its internal systems
  async init() {
    console.log('[marvin]', 'ServeCommand.init');

          this.initProject();
          this.initWatch();
    await this.initSystems();
    await this.initTools();
    await this.initChannels();
    await this.initModels();
    await this.initAgents();
  }

  // will drop all the resources from the context
  async drop() {
    console.log('[marvin]', 'ServeCommand.drop');

    if (this.ctx.state !== 'running') return;
    this.ctx.state = 'stopped';

          this.dropAgents();
          this.dropModels();
    await this.dropChannels();
    await this.dropSystems();
  }

  // create ~/.marvin folder and required files
  initProject() {
    console.log('[marvin]', 'ServeCommand.initProject');

    // set root to the app folder (where package.json lives)
    this.ctx.root = import.meta.url.replace('file://', '').replace(/\\/g, '/').replace(/\/src\/server\.ts$/, '');

    // create project/workspace folder (~/.marvin)
    const home = join(homedir(), '.marvin');
    if (!existsSync(home)) {
      mkdirSync(home, { recursive: true });
    }

    // set home (~/.marvin)
    this.ctx.home = home;

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

  initWatch() {
    console.log('[marvin]', 'ServeCommand.initWatch');

    const mpath = join(this.ctx.home, 'marvin.json');
    try {
      let w = watch(mpath, () => {
        console.log('[marvin]', 'ServeCommand.initWatch', 'config file changed, reloading...');
        this.execReload();
      });
      w.close();
    } catch (err) {
      console.warn('[marvin]', 'ServeCommand.initWatch', 'config file watcher failed:', (err as Error).message);
    }
  }

  async initSystems() {
    console.log('[marvin]', 'ServeCommand.initSystems');
    const files = listSystems(this.ctx).map(f => f.replace('.ts', ''));
    for (const name of files) {
      try {
        const Module = await import(`../systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          console.warn('[marvin]', 'ServeCommand.initSystems', `${name} does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this.ctx);
        await instance.init();
        this.ctx.systems[name] = instance;
        console.log('[marvin]', 'ServeCommand.initSystems', `loaded: ${name}`);
      } catch (err) {
        console.error('[marvin]', 'ServeCommand.initSystems', `failed to load ${name}:`, err);
      }
    }
  }

  async initTools() {
    console.log('[marvin]', 'ServeCommand.initTools');

    const files = listTools(this.ctx).map(f => f.replace('.ts', ''));
    for (const file of files) {
      const name = file;
      try {
        const Module = await import(`../tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.warn('[marvin]', 'ServeCommand.initTools', `${file} does not export a Tool class, skipping`);
          continue;
        }
        // register instance of Tool
        const instance = new Class(this.ctx);
        this.ctx.tools[instance.name()] = instance;
        console.log('[marvin]', 'ServeCommand.initTools', `loaded: ${instance.name()}`);
      } catch (err) {
        console.error('[marvin]', 'ServeCommand.initTools', `failed to load ${file}:`, err);
      }
    }
  }

  async initChannels() {
    console.log('[marvin]', 'ServeCommand.initChannels');

    const files = listChannels(this.ctx).map(f => f.replace('.ts', ''));
    for (const [id, config] of Object.entries(this.ctx.config.channels) as [string, Config['channels'][string]][]) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        console.warn('[marvin]', 'ServeCommand.initChannels', `no file for file "${file}", skipping ${id}`);
        continue;
      }

      try {
        const Module = await import(`../channels/${file}.js`);
        const Class = Module.default;
        // must be a Channel class
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.warn('[marvin]', 'ServeCommand.initChannels', `${file} does not export a Channel class, skipping ${id}`);
          continue;
        }
        // register instance of Channel 
        const instance = new Class(this.ctx);
        await instance.init();
        this.ctx.channels[id] = instance;
        console.log('[marvin]', 'ServeCommand.initChannels', `loaded: ${id}`);
      } catch (err) {
        console.error('[marvin]', 'ServeCommand.initChannels', `failed to load ${id}:`, err);
      }
    }
  }

  async initModels() {
    console.log('[marvin]', 'ServeCommand.initModels');

    const ctx = this.ctx;

    // config models
    const files = listModels(ctx).map(f => f.replace('.ts', ''))
    for (const [modelId, model] of Object.entries(ctx.config.models)) {
      if (!model.enabled) continue;

      const provider = model.provider;

      const file = files.find(f => f === provider);
      if (!file) {
        console.warn('[marvin]', 'ServeCommand.initModels', `no file for provider "${provider}", skipping ${modelId}`);
        continue;
      }

      try {
        // import the model provider
        const Module = await import(`../models/${provider}.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          console.error('[marvin]', 'ServeCommand.initModels', `${modelId} does not export a Model class, skipping`);
          continue;
        }
        
        // save instance (needed by agents)
        const instance = new Class(model);
        ctx.models[modelId] = instance;

        console.log('[marvin]', 'ServeCommand.initModels', `loaded: ${modelId} (${provider} ${model.model})`);
      } catch (err) {
        console.error('[marvin]', 'ServeCommand.initModels', `failed to load ${modelId}:`, err);
      }
    }

    // fallback model (if no other model is found)
    if (Object.keys(ctx.models).length === 0) {
      const modelId = 'fallback';

      try {
        // import the model provider
        const Module = await import(`../models/fallback.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          console.error('[marvin]', 'ServeCommand.initModels', `${modelId} does not export a Model class!`);
          process.exit(1);
        }

        const instance = new Class({provider: 'fallback', model: 'fallback'});
        ctx.models[modelId] = instance;

        // warn because fallback model is not a good idea, and does NOTHING
        console.warn('[marvin]', 'ServeCommand.initModels', `loaded: ${modelId}`);
      } catch (err) {
        console.error('[marvin]', 'ServeCommand.initModels', `failed to load ${modelId}:`, err);
      }
    }
  }

  async initAgents() {
    console.log('[marvin]', 'ServeCommand.initAgents');

    const ctx = this.ctx;

    // type: orchestrator/supervisor
    const agentId = ctx.config.settings.name;
    
    // model: default or first
    const model = Object.values(ctx.models).find(m => m.enabled && m.default) || ctx.models[Object.keys(ctx.models)[0] as string]!;

    // load agent system prompt (~/.marvin/IDENTITY.md)
    let identity = readFileSync(join(ctx.home, 'MARVIN.md'), 'utf8').trim();
    if (!identity) {
      console.warn('[marvin]', 'ServeCommand.initAgents', `no MARVIN.md found for agent ${agentId}, using default`);
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
        console.error('[marvin]', 'ServeCommand.initAgents', `model not found for agent ${agentId}: ${agent.model}`);
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
          console.warn('[marvin]', 'ServeCommand.initAgents', `no input found for task ${taskId}, disabling`);
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

        console.log('[marvin]', 'ServeCommand.initAgents', `agent ${agentId} task ${taskId} scheduled (${task.schedule}ms)`);
      }

      // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
      let identity = readFileSync(join(ctx.home, 'agents', agentId, 'IDENTITY.md'), 'utf8').trim();
      if (!identity) {
        console.warn('[marvin]', 'ServeCommand.initAgents', `no IDENTITY.md found for agent ${agentId}, using default`);
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

  dropAgents() {
    console.log('[marvin]', 'ServeCommand.dropAgents');
    const ctx = this.ctx;
    for (const agent of Object.values(ctx.agents)) {
      for (const task of Object.values(agent.tasks)) {
        if (task.timeout) clearTimeout(task.timeout);
      }
    }
    ctx.agents = {};
  }

  dropModels() {
    console.log('[marvin]', 'ServeCommand.dropModels');
    this.ctx.models = {};
  }

  // will detach and delete ALL channels from the context
  async dropChannels() {
    console.log('[marvin]', 'ServeCommand.dropChannels');
    const ctx = this.ctx;
    for (const channel of Object.values(ctx.channels)) {
      try {
        await channel.drop();
      } catch (err) {
        console.error('[marvin]', 'ServeCommand.dropChannels', `error detaching channel:`, err);
      }
    }
    ctx.channels = {};
  }

  // will detach and delete the channel from the context
  async dropChannel(id: string) {
    console.log('[marvin]', 'ServeCommand.dropChannel', id);
    const ctx = this.ctx;
    if (ctx.channels[id]) {
      try {
        ctx.channels[id].drop();
      } catch (err) {
        console.error('[marvin]', 'ServeCommand.dropChannel', `error detaching channel:`, err);
      }
      delete ctx.channels[id];
    }
  }

  async dropSystems() {
    console.log('[marvin]', 'ServeCommand.dropSystems');
    const ctx = this.ctx;
    for (const system of Object.values(ctx.systems)) {
      try {
        await system.drop();
      } catch (err) {
        console.error('[marvin]', 'ServeCommand.dropSystems', `error detaching system:`, err);
      }
    }
    ctx.systems = {};
  }

  async execTask(ctx: Context, agentId: string, taskId: string) {
    const agent = ctx.agents[agentId]!;
    const task = agent.tasks[taskId]!;

    if (!agent.enabled || !task.enabled) return;

    console.log('[marvin]', 'ServeCommand.execTask', `${agentId}/${taskId}`);

    const maxSteps = task.maxSteps || constants.DEFAULT_MAX_STEPS;

    // TODO: create a new chat or use it to retrieve the chat from cache
    const chatId = `task-${taskId}-${Date.now()}`;

    const result = await this.sendMessage(ctx, task.input, agentId, chatId, maxSteps);
    if (!result) {
      console.error('[marvin]', 'ServeCommand.execTask', `no result from sendMessage for agent ${agentId}`);
      return;
    }

    const { content, steps } = result;

    // send final result through configured channels
    for (const [channelId, groupId] of Object.entries(agent.channels)) {
      const channel = ctx.channels[channelId];

      // verify channel exists, warn if not, then skip
      if (!channel) {
        console.warn('[marvin]', 'ServeCommand.execTask', `channel ${channelId} not found, skipping`);
        continue;
      }

      // try to send, log error if failed, continue
      try {
        await channel.sendMessage({ role: 'assistant', content: content, channel: groupId } as Message);
      } catch (err) {
        console.error('[marvin]', 'ServeCommand.execTask', `channel ${channelId} send failed:`, err);
      }
    }

    // re-schedule next execution
    task.timeout = setTimeout(this.execTask.bind(this), task.schedule, ctx, agentId, taskId);
  }

  async execReload() {
    console.log('[marvin]', 'ServeCommand.execReload');
    this.ctx.state = 'reloading';

    // drop in reverse order
          this.dropAgents();
          this.dropModels();
    await this.dropChannels();
    await this.dropSystems();

    // re-init in dependency order
    await this.initSystems();
    await this.initChannels();
    await this.initModels();
    await this.initAgents();

    this.ctx.state = 'running';
  }

  async sendMessage(ctx: Context, message: string, chatId: string, agentId: string, maxSteps: number = constants.DEFAULT_MAX_STEPS) {
    const agent = ctx.agents[agentId]!;

    console.log('[marvin]', 'ServeCommand.sendMessage', `${agentId}: ${message.slice(0, 100)}`);

    // TODO: get chat from cache/store using sessionId

    const chat = { id: chatId, thinking: false, messages: [] } as Chat;

    // load agent IDENTITY.md as system message
    chat.messages.push({ role: 'system', content: agent.identity });

    // load task input as user message
    chat.messages.push({ role: 'user', content: message });

    // TODO this needs a type, Model.chat should return a proper Reply/Response/Result type
    let reply: Reply;

    // AI loop: call model, execute tool calls, repeat until done
    let steps = -1;
    do {
      steps++;

      // core of the AI loop: call model, execute tool calls, repeat until done
      reply = await agent.model.sendMessage(chat);

      // trim result, this can be really big
      console.info('[marvin]', 'ServeCommand.sendMessage', `step=${steps}`, JSON.stringify(reply));

      if (reply.stop) {
        console.warn('[marvin]', 'ServeCommand.sendMessage', `force stop at step ${steps}`);
        break;
      }

      // execute any tool calls
      if (reply.message.tools && reply.message.tools.length > 0) {
        const results: string[] = [];

        for (const tool of reply.message.tools) {
          console.log('[marvin]', 'ServeCommand.sendMessage', `executing tool: ${tool.name}`, JSON.stringify(tool.arguments));

          // TODO check for stop tool call, if found, stop the AI loop

          try {
            const args = JSON.parse(tool.arguments);
            const result = await execTool(ctx as any, tool.name, args);
            results.push(JSON.stringify(result));
          } catch (err) {
            console.error('[marvin]', 'ServeCommand.sendMessage', `tool ${tool.name} failed:`, err);
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
      console.warn('[marvin]', 'ServeCommand.sendMessage', `max steps (${maxSteps}) reached for ${agentId}`);
    }

    // TODO: more info here 
    return { content: reply?.message?.content || '', steps };
  }
}
