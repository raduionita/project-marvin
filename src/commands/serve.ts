
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';

import { Context, Command, Config, System, Model, Agent, Task, Tool, Channel, Message, Reply  } from '../types.js';
import * as constants from '../constants.js';
import { listSystems } from '../systems/index.js';
import { listTools } from '../tools/index.js';
import { listChannels } from '../channels/index.js';
import { listModels } from '../models/index.js';

// `marvin serve [help] [--dry]`
export default class ServeCommand extends Command {
  // load the app/server and its internal systems
  async load() {
    console.debug('[ServeCommand.load]');

          this.loadProject();
    await this.loadSystems();
    await this.loadTools();
    await this.loadChannels();
    await this.loadModels();
    await this.loadAgents();
  }

  // will drop all the resources from the context
  async drop() {
    console.debug('[ServeCommand.drop]');

    if (this.ctx.state !== 'running') return;
    this.ctx.state = 'stopped';

          this.dropAgents();
          this.dropModels();
    await this.dropChannels();
    await this.dropSystems();
  }

  // create ~/.marvin folder and required files
  loadProject() {
    console.debug('[ServeCommand.loadProject]', this.ctx.root);

    // create project/workspace folder (~/.marvin)
    const hpath = this.ctx.home;
    if (this.ctx.isDry) {
      console.info('[ServeCommand.loadProject]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      console.error('[ServeCommand.loadProject]', `missing ${hpath} folder`, 'please run "marvin install" again');
      return;
    }

    // set home (~/.marvin)
    this.ctx.home = hpath;

    // agents folder (~/.marvin/agents)
    const apath = join(hpath, 'agents');
    if (this.ctx.isDry) {
      console.info('[ServeCommand.loadProject]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      console.error('[ServeCommand.loadProject]', `missing ${apath} folder`, 'please run "marvin install" again');
      return;
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(hpath, 'MARVIN.md');
    if (this.ctx.isDry) {
      console.info('[ServeCommand.loadProject]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      console.error('[ServeCommand.loadProject]', `missing ${mpath} file`, 'please run "marvin install" again');
      return;
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.ctx.isDry) {
      console.info('[ServeCommand.loadProject]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      console.error('[ServeCommand.loadProject]', `missing ${cpath} file`, 'please run "marvin install" again');
      return;
    }
  }

  async loadSystems() {
    console.debug('[ServeCommand.loadSystems]');

    const files = listSystems(this.ctx).map(f => f.replace('.ts', ''));
    for (const name of files) {
      try {
        const Module = await import(`../systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          console.error('[ServeCommand.loadSystems]', `${name} does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this.ctx);
        await instance.load();
        this.ctx.systems[name] = instance;
        console.info('[ServeCommand.loadSystems]', `system ${name} loaded`);
      } catch (err) {
        console.error('[ServeCommand.loadSystems]', `failed to load ${name}:`, err);
      }
    }
  }

  async loadTools() {
    console.debug('[ServeCommand.loadTools]');

    const files = listTools(this.ctx).map(f => f.replace('.ts', ''));
    for (const file of files) {
      const name = file;
      try {
        const Module = await import(`../tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.error('[ServeCommand.loadTools]', `${file} does not export a Tool class, skipping`);
          continue;
        }
        // register instance of Tool
        const instance = new Class(this.ctx);
        const meta = instance.meta;
        this.ctx.tools[meta.name] = instance;
        console.info('[ServeCommand.loadTools]', `tool [${meta.name}] loaded`);
      } catch (err) {
        console.error('[ServeCommand.loadTools]', `failed to load ${file}:`, err);
      }
    }
  }

  async loadChannels() {
    console.log('[ServeCommand.loadChannels]');

    const files = listChannels(this.ctx).map(f => f.replace('.ts', ''));
    for (const [id, config] of Object.entries(this.ctx.config.channels) as [string, Config['channels'][string]][]) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        console.error('[ServeCommand.loadChannels]', `no file for channel "${id}", skipping`);
        continue;
      }

      try {
        const Module = await import(`../channels/${file}.js`);
        const Class = Module.default;
        // must be a Channel class
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.error('[ServeCommand.loadChannels]', `${file} does not export a Channel class, skipping ${id}`);
          continue;
        }
        // register instance of Channel 
        const instance = new Class(this.ctx);
        await instance.load();
        this.ctx.channels[id] = instance;
        console.info('[ServeCommand.loadChannels]', `channel [${id}] loaded`);
      } catch (err) {
        console.error('[ServeCommand.loadChannels]', `failed to load ${id}:`, err);
      }
    }
  }

  async loadModels() {
    console.log('[ServeCommand.loadModels]');

    const ctx = this.ctx;

    // config models
    const files = listModels(ctx).map(f => f.replace('.ts', ''))
    for (const [modelId, config] of Object.entries(ctx.config.models)) {
      try {
        if (!config.enabled) {
          console.warn('[ServeCommand.loadModels]', `model ${modelId} is disabled, skipping`);
          continue;
        }

        const file = files.find(f => f === config.provider);
        if (!file) {
          console.error('[ServeCommand.loadModels]', `no file for provider "${config.provider}", skipping ${modelId}`);
          continue;
        }

        // import the model provider
        const Module = await import(`../models/${config.provider}.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          console.error('[ServeCommand.loadModels]', `${modelId} does not export a Model class, skipping`);
          continue;
        }
        
        // save instance (needed by agents)
        const instance = new Class(this.ctx, config);
        ctx.models[modelId] = instance;

        console.info('[ServeCommand.loadModels]', `model [${modelId}] loaded (${config.provider} ${config.model})`);
      } catch (err) {
        console.error('[ServeCommand.loadModels]', `failed to load ${modelId}:`, err);
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
          console.error('[ServeCommand.loadModels]', `${modelId} does not export a Model class!`);
          process.exit(1);
        }

        const instance = new Class(this.ctx, {provider: 'fallback', model: 'fallback'});
        ctx.models[modelId] = instance;

        // warn because fallback model is not a good idea, and does NOTHING
        console.info('[ServeCommand.loadModels]', `model [${modelId}] fallback`);
      } catch (err) {
        console.error('[ServeCommand.loadModels]', `failed to load ${modelId}:`, err);
      }
    }
  }

  async loadAgents() {
    console.debug('[ServeCommand.loadAgents]');

    const ctx = this.ctx;

    // type: orchestrator/supervisor
    const marvinId = ctx.config.settings.name;
    
    // model: default or first
    const model = Object.values(ctx.models).find(m => m.enabled && m.default) || ctx.models[Object.keys(ctx.models)[0] as string]!;

    // load agent system prompt (~/.marvin/IDENTITY.md)
    let identity = readFileSync(join(ctx.home, 'MARVIN.md'), 'utf8').trim();
    if (!identity) {
      console.error('[ServeCommand.loadAgents]', `no MARVIN.md found for agent ${marvinId}, using default`);
      identity = constants.MARVIN_MD;
    }
    
    // add ochestrator agent
    ctx.agents[marvinId] = {
      id: marvinId,
      enabled: true,
      identity: identity,
      channels: {},
      model: model,
      tasks: {},
    } as Agent;

    // add dry taks to orchestrator agent
    if (this.ctx.isDry) {
      ctx.agents[marvinId].tasks['dry'] = {
        id: 'dry',
        enabled: true,
        schedule: 0,
        maxSteps: 0,
        input: '[dry] hello world',
        timeout: setTimeout(this.execTask.bind(this), 0, ctx, marvinId, 'dry'),
      } as Task;
      console.info('[ServeCommand.loadAgents]', '[dry]', `task [dry] scheduled (orchestrator)`);
    } else {
      ctx.agents[marvinId].tasks['status'] = {
        id: 'dry',
        enabled: true,
        schedule: 60*60*1000,
        maxSteps: 0,
        input: 'status',
        timeout: setTimeout(this.execOrchestrator.bind(this), 60*60*1000, ctx, marvinId, 'status'),
      } as Task;
    }

    // type: agent
    for (const [agentId, agent] of Object.entries(ctx.config.agents)) {
      const model = ctx.models[agent.model || ''];
      if (!model) {
        console.error('[ServeCommand.loadAgents]', `model not found for agent ${agentId}: ${agent.model}`);
        continue;
      }

      const tasks: Record<string, Task> = {};
      for (const [taskId, task] of Object.entries(agent.tasks || {})) {
        let schedule = 1000 < task.schedule ? task.schedule : task.schedule * 1000;
        let enabled = task.enabled;

        // default input to task.input as string/prompt
        let input = task.input;

        // if ends with .md
        if (input && !input.endsWith('.md')) {
          // continue as is, input is a string
        } else if (existsSync(join(ctx.home, 'agents', agentId, 'tasks', `${taskId.toUpperCase()}.md`))) {
          // TAASK-ID-UPPERCASE.md
          input = readFileSync(join(ctx.home, 'agents', agentId, 'tasks', `${taskId.toUpperCase()}.md`), 'utf8').trim();
        } else if (existsSync(join(ctx.home, 'agents', agentId, 'tasks', `${taskId}.md`))) {
          // task-ID-as-is.md
          input = readFileSync(join(ctx.home, 'agents', agentId, 'tasks', `${taskId}.md`), 'utf8').trim();
        }

        if (!input) {
          console.warn('[ServeCommand.loadAgents]', `no input found for task ${taskId}, disabling`);
          enabled = false;
        }

        if (this.ctx.isDry) {
          console.info('[ServeCommand.loadAgents]', `[dry] task ${taskId} scheduled (${schedule}ms) (agent ${agentId})`);
          continue;
        }

        // add task to agent
        tasks[taskId] = {
          id: taskId,
          enabled: enabled,
          schedule: schedule,
          maxSteps: task.maxSteps,
          input: input,
          timeout: setTimeout(this.execTask.bind(this), schedule, ctx, agentId, taskId),
        } as Task;

        console.info('[ServeCommand.loadAgents]', `task [${taskId}] scheduled (${schedule}ms) (agent ${agentId})`);
      }

      // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
      let identity = readFileSync(join(ctx.home, 'agents', agentId, 'IDENTITY.md'), 'utf8').trim();
      if (!identity) {
        console.warn('[ServeCommand.loadAgents]', `no IDENTITY.md found for agent ${agentId}, using default`);
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

      console.info('[ServeCommand.loadAgents]',`agent [${agentId}] loaded`);
    }
  }

  dropAgents() {
    console.log('[ServeCommand.dropAgents]');
    const ctx = this.ctx;
    for (const agent of Object.values(ctx.agents)) {
      for (const task of Object.values(agent.tasks)) {
        if (task.timeout) { 
          console.log('[ServeCommand.dropAgents]', `stopping task ${task.id}`);
          clearTimeout(task.timeout);
        }
      }
    }
    ctx.agents = {};
  }

  dropModels() {
    console.log('[ServeCommand.dropModels]');
    this.ctx.models = {};
  }

  // will detach and delete ALL channels from the context
  async dropChannels() {
    console.log('[ServeCommand.dropChannels]');
    const ctx = this.ctx;
    for (const channel of Object.values(ctx.channels)) {
      try {
        await channel.drop();
      } catch (err) {
        console.error('[ServeCommand.dropChannels]', `error detaching channel:`, err);
      }
    }
    ctx.channels = {};
  }

  // will detach and delete the channel from the context
  async dropChannel(id: string) {
    console.log('[ServeCommand.dropChannel]', id);
    const ctx = this.ctx;
    if (ctx.channels[id]) {
      try {
        ctx.channels[id].drop();
      } catch (err) {
        console.error('[ServeCommand.dropChannel]', `error detaching channel:`, err);
      }
      delete ctx.channels[id];
    }
  }

  async dropSystems() {
    console.log('[ServeCommand.dropSystems]');
    const ctx = this.ctx;
    for (const system of Object.values(ctx.systems)) {
      try {
        await system.drop();
      } catch (err) {
        console.error('[ServeCommand.dropSystems]', `error detaching system:`, err);
      }
    }
    ctx.systems = {};
  }

  async execOrchestrator(ctx: Context, agentId: string, taskId: string) {
    console.debug('[ServeCommand.execOrchestrator]', agentId, taskId);

    // check assistant state
    if (this.ctx.state  !== 'running') {
      console.info('[ServeCommand.execOrchestrator]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = ctx.agents[agentId];
    if (!agent) {
      console.error('[ServeCommand.execOrchestrator]', `agent ${agentId} NOT found`);
      return;
    }
    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      console.error('[ServeCommand.execOrchestrator]', `task ${taskId} NOT found`);
      return;
    }
    
    // log agents and their tasks
    console.info('[ServeCommand.execOrchestrator]', `marvin agents:`);
    for (const [agentId, agent] of Object.entries(ctx.agents)) {
      console.info('[ServeCommand.execOrchestrator]', `  agent ${agentId}:`);
      console.info('[ServeCommand.execOrchestrator]', `    enabled: ${agent.enabled?'yes':'no'}`);
      console.info('[ServeCommand.execOrchestrator]', `    model: ${agent.model.model}`);
      console.info('[ServeCommand.execOrchestrator]', `    channels:`);
      for (const [channelId, channel] of Object.entries(agent.channels)) {
        console.info('[ServeCommand.execOrchestrator]', `      channel: ${channelId} ${channel}`);
      }
      console.info('[ServeCommand.execOrchestrator]', `    tasks:`);
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        console.info('[ServeCommand.execOrchestrator]', `      task ${taskId}: ${task.schedule}ms ${task.enabled?'enabled':'disabled'}`);
      }
    }
    
    // re-schedule next execution
    task.timeout = setTimeout(this.execOrchestrator.bind(this), task.schedule, ctx, agentId, taskId);
  }

  async execTask(ctx: Context, agentId: string, taskId: string) {
    console.log('[ServeCommand.execTask]', `${agentId}/${taskId}`);

    // check assistant state
    if (this.ctx.state  !== 'running') {
      console.info('[ServeCommand.execTask]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = ctx.agents[agentId];
    if (!agent) {
      console.info('[ServeCommand.execTask]', `task ${taskId} skipped (agent not found)`);
      return;
    }
    // check if agent is enabled
    if (!agent.enabled) {
      console.info('[ServeCommand.execTask]', `task ${taskId} skipped (agent disabled)`);
      return;
    }

    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      console.info('[ServeCommand.execTask]', `task ${taskId} skipped (task not found)`);
      return;
    }
    // check if task is enabled
    if (!task.enabled) {
      console.info('[ServeCommand.execTask]', `task ${taskId} skipped (task disabled)`);
      return;
    }

    const maxSteps = task.maxSteps || constants.DEFAULT_MAX_STEPS;

    // TODO: should tasks have cached chats? chatId = `task-${agentId}-${taskId}-${Date.now()}`;
    const chatId = undefined; // stateless, design choice, for not

    // set task input as user message to LLM
    const result = await this.sendMessage(ctx, task.input, chatId, agentId, maxSteps);
    if (!result) {
      console.error('[ServeCommand.execTask]', `no result from sendMessage for agent ${agentId}`);
      return;
    }

    // send final result through configured channels
    for (const [channelId, groupId] of Object.entries(agent.channels)) {
      try {
        const channel = ctx.channels[channelId];

        // verify channel exists, warn if not, then skip
        if (!channel) {
          console.warn('[ServeCommand.execTask]', `channel ${channelId} not found, skipping`);
          continue;
        }

        const reply = await channel.sendMessage({ role: 'assistant', content: result.content, channel: groupId } as Message);
        if (!reply.ok) {
          console.warn('[ServeCommand.execTask]', `channel ${channelId} send failed, skipping`);
          continue;
        }

        // try to send, log error if failed, continue
        console.info('[ServeCommand.execTask]', `message sent to channel ${channelId}:${groupId}`);
      } catch (err) {
        console.error('[ServeCommand.execTask]', `channel ${channelId} send failed:`, err);
      }
    }

    if (this.ctx.isDry) {
      console.info('[ServeCommand.execTask]', '[dry]', 'task executed (once)');
      return;
    }

    // re-schedule next execution
    task.timeout = setTimeout(this.execTask.bind(this), task.schedule, ctx, agentId, taskId);
  }

  async execReload() {
    console.log('[ServeCommand.execReload]');
    this.ctx.state = 'reloading';

    // drop in reverse order
          this.dropAgents();
          this.dropModels();
    await this.dropChannels();
    await this.dropSystems();

    // re-load in dependency order
    await this.loadSystems();
    await this.loadChannels();
    await this.loadModels();
    await this.loadAgents();

    this.ctx.state = 'running';
  }

  async  execTool(tool: string, args: any) : Promise<{[key:string]:any}> {
    console.debug('[ServeCommand.execTool]', tool);

    const instance = this.ctx.tools[tool];
    if (!instance) {
      console.error('[ServeCommand.execTool]', `tool ${tool} not found`);
      return {tool: tool, error: `tool ${tool} does NOT exist`};
    }

    return await instance.call(args);
  }

  async sendMessage(ctx: Context, message: string, chatId: string | undefined, agentId: string, maxSteps: number = constants.DEFAULT_MAX_STEPS) : Promise<{content:string, steps:number} | null> {
    try {
      console.debug('[ServeCommand.sendMessage]', chatId, agentId, message.slice(0, 100));

      // get chat from cache/store using sessionId
      const chat = this.ctx.cache.findChat(chatId);

      const agent = ctx.agents[agentId]!;

      // load agent IDENTITY.md as system message
      chat.messages.push({ role: 'system', content: agent.identity });

      // load task input as user message
      chat.messages.push({ role: 'user', content: message });

      // return early
      if (this.ctx.isDry) {
        console.info('[ServeCommand.sendMessage]', '[dry]', 'send messages to:', agent.model.model);
        return { content: '(dry)', steps: 0 };
      }

      // TODO this needs a type, Model.chat should return a proper Reply/Response/Result type
      let reply: Reply;

      // AI loop: call model, execute tool calls, repeat until done
      let steps = -1;
      let ender = false;
      do {
        steps++;

        // core of the AI loop: call model, execute tool calls, repeat until done
        reply = await agent.model.sendMessage(chat);

        // persist assistant reply to chat history
        chat.messages.push({ role: 'assistant', content: reply.message.content || '' });

        // trim result, this can be really big
        console.info('[ServeCommand.sendMessage]', `step=${steps}`, JSON.stringify(reply));

        // force stop
        if (reply.stop) {
          console.info('[ServeCommand.sendMessage]', `response force stop at step ${steps}`);
          break;
        }

        // execute any tool calls
        if (reply.message.tools && reply.message.tools.length > 0) {
          for (const tool of reply.message.tools) {
            console.log('[ServeCommand.sendMessage]', `executing tool: ${tool.name}`, JSON.stringify(tool.arguments));

            if (tool.name === constants.END_CHAT_NAME) {
              ender = true;
              break;
            }

            let result: any;
            try {
              const args = JSON.parse(tool.arguments);
              result = await this.execTool(tool.name, args);
            } catch (err) {
              console.error('[ServeCommand.sendMessage]', `tool ${tool.name} failed:`, err);
              result = {error: (err as Error).message};
            }

            // add tool call to chat history
            chat.messages.push({ role: 'tool', content: JSON.stringify(result), toolId: tool.id });
          }
        }

        // if model produced content without pending tool calls, we're done
        // if (reply.message.content && (!reply.message.tools || reply.message.tools.length === 0)) {
        //   console.info('[ServeCommand.sendMessage]', `response without tool calls, stopping the AI loop`);
        //   break;
        // }

        // if end_chat tool call is found, we're done
        if (ender) {
          console.info('[ServeCommand.sendMessage]', `found ${constants.END_CHAT_NAME} tool call, stopping the AI loop`);
          break;
        }
      } while (steps < maxSteps - 1);

      // warn if max steps reached
      if (steps >= maxSteps) {
        console.warn('[ServeCommand.sendMessage]', `max steps (${maxSteps}) reached for ${agentId}`);
      }

      // save chat to cache
      this.ctx.cache.saveChat(chatId, chat);

      // TODO: more info here
      return { content: reply?.message?.content || '', steps: steps };
    } catch (error) {
      console.error('[ServeCommand.sendMessage]', error);
      return null;
    } 
  }
}
