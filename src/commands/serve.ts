
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
  // initialize the app/server and its internal systems
  async init() {
    console.debug('[ServeCommand.init]');

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
    console.debug('[ServeCommand.drop]');

    if (this.ctx.state !== 'running') return;
    this.ctx.state = 'stopped';

          this.dropAgents();
          this.dropModels();
    await this.dropChannels();
    await this.dropSystems();
  }

  // create ~/.marvin folder and required files
  initProject() {
    console.debug('[ServeCommand.initProject]');

    // set root to the app folder (where package.json lives)
    this.ctx.root = import.meta.url.replace('file://', '').replace(/\\/g, '/').replace(/\/src\/commands\/serve\.ts$/, '');
    console.info('root directory:', this.ctx.root);

    // create project/workspace folder (~/.marvin)
    const hpath = join(homedir(), '.marvin');
    if (this.ctx.isDry) {
      console.info('[ServeCommand.initProject]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      console.warn('[ServeCommand.initProject]', `missing ${hpath} folder, creating...`);
      mkdirSync(hpath, { recursive: true });
    }

    // set home (~/.marvin)
    this.ctx.home = hpath;

    // agents folder (~/.marvin/agents)
    const apath = join(hpath, 'agents');
    if (this.ctx.isDry) {
      console.info('[ServeCommand.initProject]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      console.warn('[ServeCommand.initProject]', `missing ${apath} folder, creating...`);
      mkdirSync(apath, { recursive: true });
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(hpath, 'MARVIN.md');
    if (this.ctx.isDry) {
      console.info('[ServeCommand.initProject]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      console.warn('[ServeCommand.initProject]', `missing ${mpath} file, creating...`);
      writeFileSync(mpath, constants.MARVIN_MD.trim());
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.ctx.isDry) {
      console.info('[ServeCommand.initProject]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      console.warn('[ServeCommand.initProject]', `missing ${cpath} file, creating...`);
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
    }
  }

  initWatch() {
    console.debug('[ServeCommand.initWatch]');

    // TODO: watch the whole project folder

    const mpath = join(this.ctx.home, 'marvin.json');

    // watch config file
    if (this.ctx.isDry) {
      console.info('[dry]', 'would watch config file:', mpath);
    } else {
      try {
        let w = watch(mpath, () => {
          console.debug('config file changed, reloading...');
          this.execReload();
        });
        w.close();
      } catch (err) {
        console.error('[ServeCommand.initWatch]', 'config file watcher failed:', (err as Error).message);
      }
    }
  }

  async initSystems() {
    console.debug('[ServeCommand.initSystems]');

    const files = listSystems(this.ctx).map(f => f.replace('.ts', ''));
    for (const name of files) {
      try {
        const Module = await import(`../systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          console.error('[ServeCommand.initSystems]', `${name} does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this.ctx);
        await instance.init();
        this.ctx.systems[name] = instance;
        console.info(`system ${name} loaded`);
      } catch (err) {
        console.error('[ServeCommand.initSystems]', `failed to load ${name}:`, err);
      }
    }
  }

  async initTools() {
    console.debug('[ServeCommand.initTools]');

    const files = listTools(this.ctx).map(f => f.replace('.ts', ''));
    for (const file of files) {
      const name = file;
      try {
        const Module = await import(`../tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.error('[ServeCommand.initTools]', `${file} does not export a Tool class, skipping`);
          continue;
        }
        // register instance of Tool
        const instance = new Class(this.ctx);
        const meta = instance.meta();
        this.ctx.tools[meta.name] = instance;
        console.info(`tool [${meta.name}] loaded`);
      } catch (err) {
        console.error('[ServeCommand.initTools]', `failed to load ${file}:`, err);
      }
    }
  }

  async initChannels() {
    console.log('[ServeCommand.initChannels]');

    const files = listChannels(this.ctx).map(f => f.replace('.ts', ''));
    for (const [id, config] of Object.entries(this.ctx.config.channels) as [string, Config['channels'][string]][]) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        console.error('[ServeCommand.initChannels]', `no file for file "${file}", skipping ${id}`);
        continue;
      }

      try {
        const Module = await import(`../channels/${file}.js`);
        const Class = Module.default;
        // must be a Channel class
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.error('[ServeCommand.initChannels]', `${file} does not export a Channel class, skipping ${id}`);
          continue;
        }
        // register instance of Channel 
        const instance = new Class(this.ctx);
        await instance.init();
        this.ctx.channels[id] = instance;
        console.info(`channel [${id}] loaded`);
      } catch (err) {
        console.error('[ServeCommand.initChannels]', `failed to load ${id}:`, err);
      }
    }
  }

  async initModels() {
    console.log('[ServeCommand.initModels]');

    const ctx = this.ctx;

    // config models
    const files = listModels(ctx).map(f => f.replace('.ts', ''))
    for (const [modelId, config] of Object.entries(ctx.config.models)) {
      try {
        if (!config.enabled) {
          console.warn('[ServeCommand.initModels]', `model ${modelId} is disabled, skipping`);
          continue;
        }

        const file = files.find(f => f === config.provider);
        if (!file) {
          console.error('[ServeCommand.initModels]', `no file for provider "${config.provider}", skipping ${modelId}`);
          continue;
        }

        // import the model provider
        const Module = await import(`../models/${config.provider}.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          console.error('[ServeCommand.initModels]', `${modelId} does not export a Model class, skipping`);
          continue;
        }
        
        // save instance (needed by agents)
        const instance = new Class(this.ctx, config);
        ctx.models[modelId] = instance;

        console.info(`model [${modelId}] loaded (${config.provider} ${config.model})`);
      } catch (err) {
        console.error('[ServeCommand.initModels]', `failed to load ${modelId}:`, err);
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
          console.error('[ServeCommand.initModels]', `${modelId} does not export a Model class!`);
          process.exit(1);
        }

        const instance = new Class(this.ctx, {provider: 'fallback', model: 'fallback'});
        ctx.models[modelId] = instance;

        // warn because fallback model is not a good idea, and does NOTHING
        console.info(`model [${modelId}] fallback`);
      } catch (err) {
        console.error('[ServeCommand.initModels]', `failed to load ${modelId}:`, err);
      }
    }
  }

  async initAgents() {
    console.log('[ServeCommand.initAgents]');

    const ctx = this.ctx;

    // type: orchestrator/supervisor
    const marvinId = ctx.config.settings.name;
    
    // model: default or first
    const model = Object.values(ctx.models).find(m => m.enabled && m.default) || ctx.models[Object.keys(ctx.models)[0] as string]!;

    // load agent system prompt (~/.marvin/IDENTITY.md)
    let identity = readFileSync(join(ctx.home, 'MARVIN.md'), 'utf8').trim();
    if (!identity) {
      console.error('[ServeCommand.initAgents]', `no MARVIN.md found for agent ${marvinId}, using default`);
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
        input: 'hello world',
        timeout: setTimeout(this.execTask.bind(this), 0, ctx, marvinId, 'dry'),
      } as Task;
      console.info('[dry]', `task [dry] scheduled (orchestrator)`);
    }

    // type: agent
    for (const [agentId, agent] of Object.entries(ctx.config.agents)) {
      const model = ctx.models[agent.model || ''];
      if (!model) {
        console.error('[ServeCommand.initAgents]', `model not found for agent ${agentId}: ${agent.model}`);
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
          console.warn('[ServeCommand.initAgents]', `no input found for task ${taskId}, disabling`);
          enabled = false;
        }

        if (this.ctx.isDry) {
          console.info(`[dry] task ${taskId} scheduled (${task.schedule}ms) (agent ${agentId})`);
          continue;
        }

        // add task to agent
        tasks[taskId] = {
          id: taskId,
          enabled: enabled,
          schedule: task.schedule,
          maxSteps: task.maxSteps,
          input: input,
          timeout: setTimeout(this.execTask.bind(this), task.schedule, ctx, agentId, taskId),
        } as Task;

        console.info(`task [${taskId}] scheduled (${task.schedule}ms) (agent ${agentId})`);
      }

      // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
      let identity = readFileSync(join(ctx.home, 'agents', agentId, 'IDENTITY.md'), 'utf8').trim();
      if (!identity) {
        console.warn('[ServeCommand.initAgents]', `no IDENTITY.md found for agent ${agentId}, using default`);
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

      console.info(`agent [${agentId}] loaded`);
    }
  }

  dropAgents() {
    console.log('[ServeCommand.dropAgents]');
    const ctx = this.ctx;
    for (const agent of Object.values(ctx.agents)) {
      for (const task of Object.values(agent.tasks)) {
        if (task.timeout) clearTimeout(task.timeout);
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

  async execTask(ctx: Context, agentId: string, taskId: string) {
    console.log('[ServeCommand.execTask]', `${agentId}/${taskId}`);

    const agent = ctx.agents[agentId]!;
    const task = agent.tasks[taskId]!;

    if (!agent.enabled || !task.enabled) {
      console.info(`task ${taskId} skipped (agent ${agentId})`);
      return;
    }

    const maxSteps = task.maxSteps || constants.DEFAULT_MAX_STEPS;

    // TODO: create a new chat or use it to retrieve the chat from cache
    const chatId = `task-${taskId}-${Date.now()}`;

    // set task input as user message to LLM
    const result = await this.sendMessage(ctx, task.input, agentId, chatId, maxSteps);
    if (!result) {
      console.error('[ServeCommand.execTask]', `no result from sendMessage for agent ${agentId}`);
      return;
    }

    const { content, steps } = result;

    // send final result through configured channels
    for (const [channelId, groupId] of Object.entries(agent.channels)) {
      const channel = ctx.channels[channelId];

      // verify channel exists, warn if not, then skip
      if (!channel) {
        console.warn('[ServeCommand.execTask]', `channel ${channelId} not found, skipping`);
        continue;
      }

      // try to send, log error if failed, continue
      try {
        console.info(`channel sending message to ${channelId}:${groupId}...`);
        await channel.sendMessage({ role: 'assistant', content: content, channel: groupId } as Message);
      } catch (err) {
        console.error('[ServeCommand.execTask]', `channel ${channelId} send failed:`, err);
      }
    }

    if (this.ctx.isDry) {
      console.info('[dry] task executed (once)');
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

    // re-init in dependency order
    await this.initSystems();
    await this.initChannels();
    await this.initModels();
    await this.initAgents();

    this.ctx.state = 'running';
  }

  async  execTool(tool: string, args: any) : Promise<{[key:string]:any}> {
    console.debug('[ServeCommand.execTool]', tool);

    const instance = this.ctx.tools[tool];
    if (!instance) {
      throw new Error(`ServeCommand.execTool: Tool ${tool} not found`);
    }
    return await instance.call(args);
  }

  async sendMessage(ctx: Context, message: string, chatId: string, agentId: string, maxSteps: number = constants.DEFAULT_MAX_STEPS) {
    console.debug('[ServeCommand.sendMessage]', `${agentId}: ${message.slice(0, 100)}`);
    
    const agent = ctx.agents[agentId]!;

    // get chat from cache/store using sessionId
    const chat = this.ctx.cache.findChat(chatId);

    // load agent IDENTITY.md as system message
    chat.messages.push({ role: 'system', content: agent.identity });

    // load task input as user message
    chat.messages.push({ role: 'user', content: message });

    // return early
    if (this.ctx.isDry) {
      console.info('[dry] send messages to:', agent.model.model);
      return { content: '(dry)', steps: 0 };
    }

    // TODO this needs a type, Model.chat should return a proper Reply/Response/Result type
    let reply: Reply;

    // AI loop: call model, execute tool calls, repeat until done
    let steps = -1;
    let final = false;
    do {
      steps++;

      // core of the AI loop: call model, execute tool calls, repeat until done
      reply = await agent.model.sendMessage(chat);

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

          if (tool.name === constants.FINAL_ANSWER_NAME) {
            final = true;
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

      // if final answer tool call is found, we're done
      if (final) {
        console.info('[ServeCommand.sendMessage]', `found final answer tool call, stopping the AI loop`);
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
    return { content: reply?.message?.content || '', steps };
  }
}
