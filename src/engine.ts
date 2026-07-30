import { existsSync, readFileSync } from "fs";

import { listSystems } from "./systems";
import { Command, Config, Channel, Tool, Model, Agent, System, ToolMeta, Task, Cache, Message, Reply } from "./types";
import * as constants from './constants.js';
import { listTools } from "./tools/index.js";
import { listChannels } from "./channels/index.js";
import { listModels } from "./models/index.js";
import { join } from "path";

export default class Engine {
  public state: 'running' | 'reloading' | 'stopped' = 'running';

  public command: Command = {} as Command;

  public config: Config = {} as Config;

  public cache: Cache = new Cache();

  // TODO: later consider moving browser, http, watch (file watcher) to a separate group "systems"
  public systems: Record<string, System> = {};

  // channels, models, agents
  public channels: Record<string, Channel> = {};
  public tools   : Record<string, Tool> = {};
  public models  : Record<string, Model> = {};
  public agents  : Record<string, Agent> = {};

  // home (~/.marvin) data folder
  public home: string = process.env.HOME + '/.marvin';
  // root (~/) app folder
  public root: string = import.meta.dirname.replace(/\/src.*/, '');

  public isDry: boolean = process.argv.includes('--dry') || process.argv.includes('-dry');
  public isTest: boolean = process.env.NODE_ENV === 'test' || process.env.BUN_TEST === '1';

  public get isDebug() { return this.config.settings.logLevel === 'debug'; }

  async scanProject() {
    // create project/workspace folder (~/.marvin)
    const hpath = this.home;
    if (this.isDry) {
      console.info('[Engine.scanProject]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      console.error('[Engine.scanProject]', `missing ${hpath} folder`, 'please run "marvin install" again');
      return;
    }

    // agents folder (~/.marvin/agents)
    const apath = join(hpath, 'agents');
    if (this.isDry) {
      console.info('[Engine.scanProject]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      console.error('[Engine.scanProject]', `missing ${apath} folder`, 'please run "marvin install" again');
      return;
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(hpath, 'MARVIN.md');
    if (this.isDry) {
      console.info('[Engine.scanProject]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      console.error('[Engine.scanProject]', `missing ${mpath} file`, 'please run "marvin install" again');
      return;
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.isDry) {
      console.info('[Engine.scanProject]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      console.error('[Engine.scanProject]', `missing ${cpath} file`, 'please run "marvin install" again');
      return;
    }
  }

  async loadSystems() {
    console.debug('[Engine.loadSystems]');

    const files = listSystems(this).map(f => f.replace('.ts', ''));
    for (const name of files) {
      try {
        const Module = await import(`./systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          console.error('[Engine.loadSystems]', `${name} does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this);
        await instance.load();
        this.systems[name] = instance;
        console.info('[Engine.loadSystems]', `system [${name}] loaded`);
      } catch (err) {
        console.error('[Engine.loadSystems]', `failed to load ${name}:`, err);
      }
    }
  }

  async loadTools() {
    console.debug('[Engine.loadTools]');

    const files = listTools(this).map(f => f.replace('.ts', ''));
    for (const file of files) {
      const name = file;
      try {
        const Module = await import(`./tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.error('[Engine.loadTools]', `${file} does not export a Tool class, skipping`);
          continue;
        }
        // register instance of Tool
        const instance = new Class(this);
        const meta = instance.meta as ToolMeta;
        this.tools[meta.function.name] = instance;
        console.info('[Engine.loadTools]', `tool [${meta.function.name}] loaded`);
      } catch (err) {
        console.error('[Engine.loadTools]', `failed to load ${file}:`, err);
      }
    }
  }

  async loadChannels() {
    console.log('[Engine.loadChannels]');

    const files = listChannels(this).map(f => f.replace('.ts', ''));
    for (const [id, config] of Object.entries(this.config.channels) as [string, Config['channels'][string]][]) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        console.error('[Engine.loadChannels]', `no file for channel "${id}", skipping`);
        continue;
      }

      try {
        const Module = await import(`./channels/${file}.js`);
        const Class = Module.default;
        // must be a Channel class
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.error('[Engine.loadChannels]', `${file} does not export a Channel class, skipping ${id}`);
          continue;
        }
        // register instance of Channel 
        const instance = new Class(this);
        await instance.load();
        this.channels[id] = instance;
        console.info('[Engine.loadChannels]', `channel [${id}] loaded`);
      } catch (err) {
        console.error('[Engine.loadChannels]', `failed to load ${id}:`, err);
      }
    }
  }

  async loadModels() {
    console.log('[Engine.loadModels]');

    // config models
    const files = listModels(this).map(f => f.replace('.ts', ''))
    for (const [modelId, config] of Object.entries(this.config.models)) {
      try {
        if (!config.enabled) {
          console.warn('[Engine.loadModels]', `model ${modelId} is disabled, skipping`);
          continue;
        }

        const file = files.find(f => f === config.provider);
        if (!file) {
          console.error('[Engine.loadModels]', `no file for provider "${config.provider}", skipping ${modelId}`);
          continue;
        }

        // import the model provider
        const Module = await import(`./models/${config.provider}.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          console.error('[Engine.loadModels]', `${modelId} does not export a Model class, skipping`);
          continue;
        }
        
        // save instance (needed by agents)
        const instance = new Class(this, config);
        this.models[modelId] = instance;

        console.info('[Engine.loadModels]', `model [${modelId}] loaded (${config.provider} ${config.model})`);
      } catch (err) {
        console.error('[Engine.loadModels]', `failed to load ${modelId}:`, err);
      }
    }

    // fallback model (if no other model is found)
    if (Object.keys(this.models).length === 0) {
      const modelId = 'fallback';

      try {
        // import the model provider
        const Module = await import(`./models/fallback.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          console.error('[Engine.loadModels]', `${modelId} does not export a Model class!`);
          process.exit(1);
        }

        const instance = new Class(this, {provider: 'fallback', model: 'fallback'});
        this.models[modelId] = instance;

        // warn because fallback model is not a good idea, and does NOTHING
        console.info('[Engine.loadModels]', `model [${modelId}] fallback`);
      } catch (err) {
        console.error('[Engine.loadModels]', `failed to load ${modelId}:`, err);
      }
    }
  }

  async loadAgents() {
    console.debug('[Engine.loadAgents]');

    // type: orchestrator/supervisor
    {
      console.debug('[Engine.loadAgents]');

      const marvinId = this.config.settings.name;
      
      // model: default or first
      const model = Object.values(this.models).find(m => m.enabled && m.default) || this.models[Object.keys(this.models)[0] as string]!;

      // load agent system prompt (~/.marvin/IDENTITY.md)
      let identity = readFileSync(join(this.home, 'MARVIN.md'), 'utf8').trim();
      if (!identity) {
        console.error('[Engine.loadAgents]', `no MARVIN.md found for agent ${marvinId}, using default`);
        identity = constants.MARVIN_MD;
      }
      
      // add ochestrator agent
      this.agents[marvinId] = {
        id: marvinId,
        enabled: true,
        identity: identity,
        channels: {},
        model: model,
        tasks: {},
      } as Agent;

      // add dry taks to orchestrator agent
      this.agents[marvinId].tasks['status'] = {
        id: 'status',
        enabled: true,
        schedule: 60*60*1000,
        maxSteps: 0,
        input: 'status',
      } as Task;

      console.info('[Engine.loadAgents]', `task [status] created (orchestrator ${marvinId})`);

      console.info('[Engine.loadAgents]',`agent [${marvinId}] loaded`);
    }

    // type: agent
    for (const [agentId, agent] of Object.entries(this.config.agents)) {
      const model = this.models[agent.model || ''];
      if (!model) {
        console.error('[Engine.loadAgents]', `model not found for agent ${agentId}: ${agent.model}`);
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
        } else if (existsSync(join(this.home, 'agents', agentId, 'tasks', `${taskId.toUpperCase()}.md`))) {
          // TAASK-ID-UPPERCASE.md
          input = readFileSync(join(this.home, 'agents', agentId, 'tasks', `${taskId.toUpperCase()}.md`), 'utf8').trim();
        } else if (existsSync(join(this.home, 'agents', agentId, 'tasks', `${taskId}.md`))) {
          // task-ID-as-is.md
          input = readFileSync(join(this.home, 'agents', agentId, 'tasks', `${taskId}.md`), 'utf8').trim();
        }

        if (!input) {
          console.warn('[Engine.loadAgents]', `no input found for task ${taskId}, disabling`);
          enabled = false;
        }

        if (this.isDry) {
          console.info('[Engine.loadAgents]', `[dry] task ${taskId} created (agent ${agentId})`);
          continue;
        }

        // add task to agent
        tasks[taskId] = {
          id: taskId,
          enabled: enabled,
          schedule: schedule,
          maxSteps: task.maxSteps,
          input: input,
        } as Task;

        console.info('[Engine.loadAgents]', `task [${taskId}] created (agent ${agentId})`);
      }

      // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
      let identity = readFileSync(join(this.home, 'agents', agentId, 'IDENTITY.md'), 'utf8').trim();
      if (!identity) {
        console.warn('[Engine.loadAgents]', `no IDENTITY.md found for agent ${agentId}, using default`);
        identity = constants.IDENTITY_MD;
      }

      this.agents[agentId] = {
        id: agentId,
        enabled: agent.enabled,
        identity: identity,
        channels: agent.channels,
        model: model,
        tasks: tasks,
      } as Agent;

      console.info('[Engine.loadAgents]',`agent [${agentId}] loaded`);
    }
  }

  dropAgents() {
    console.log('[Engine.dropAgents]');
    for (const agent of Object.values(this.agents)) {
      for (const task of Object.values(agent.tasks)) {
        if (task.timeout) { 
          console.log('[Engine.dropAgents]', `stopping task ${task.id}`);
          clearTimeout(task.timeout);
        }
      }
    }
    this.agents = {};
  }

  dropModels() {
    console.log('[Engine.dropModels]');
    this.models = {};
  }

  // will detach and delete ALL channels from the context
  async dropChannels() {
    console.log('[Engine.dropChannels]');
    for (const channel of Object.values(this.channels)) {
      try {
        await channel.drop();
      } catch (err) {
        console.error('[Engine.dropChannels]', `error detaching channel:`, err);
      }
    }
    this.channels = {};
  }

  // will detach and delete the channel from the context
  async dropChannel(id: string) {
    console.log('[Engine.dropChannel]', id);
    if (this.channels[id]) {
      try {
        this.channels[id].drop();
      } catch (err) {
        console.error('[Engine.dropChannel]', `error detaching channel:`, err);
      }
      delete this.channels[id];
    }
  }

  async dropSystems() {
    console.log('[Engine.dropSystems]');
    for (const system of Object.values(this.systems)) {
      try {
        await system.drop();
      } catch (err) {
        console.error('[Engine.dropSystems]', `error detaching system:`, err);
      }
    }
    this.systems = {};
  }

  // for each agent, for each task, start setTimeout
  async execAgents() {
    console.debug('[Engine.execAgents]');

    for (const [agentId, agent] of Object.entries(this.agents)) {
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        if (this.isDry) {
          console.info('[Engine.execAgents]', `[dry] task ${taskId} scheduled (${task.schedule}ms) (agent ${agentId})`);
          continue;
        }
        if (agentId === this.config.settings.name) {
          task.timeout = setTimeout(this.execOrchestrator.bind(this), task.schedule, agentId, taskId);
          console.debug('[Engine.execAgents]', `task [${taskId}] scheduled (${task.schedule}ms) (orchestrator ${agentId})`);
        } else {
          task.timeout = setTimeout(this.execTask.bind(this), task.schedule, agentId, taskId);
          console.debug('[Engine.execAgents]', `task [${taskId}] scheduled (${task.schedule}ms) (agent ${agentId})`);
        }
      }
    }
  }

  async execOrchestrator(agentId: string, taskId: string) {
    console.debug('[Engine.execOrchestrator]', agentId, taskId);

    // check assistant state
    if (this.state  !== 'running') {
      console.info('[Engine.execOrchestrator]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = this.agents[agentId];
    if (!agent) {
      console.error('[Engine.execOrchestrator]', `agent ${agentId} NOT found`);
      return;
    }
    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      console.error('[Engine.execOrchestrator]', `task ${taskId} NOT found`);
      return;
    }
    
    // log agents and their tasks
    console.info('[Engine.execOrchestrator]', `marvin agents:`);
    for (const [agentId, agent] of Object.entries(this.agents)) {
      console.info('[Engine.execOrchestrator]', `  agent ${agentId}:`);
      console.info('[Engine.execOrchestrator]', `    enabled: ${agent.enabled?'yes':'no'}`);
      console.info('[Engine.execOrchestrator]', `    model: ${agent.model.model}`);
      console.info('[Engine.execOrchestrator]', `    channels:`);
      for (const [channelId, channel] of Object.entries(agent.channels)) {
        console.info('[Engine.execOrchestrator]', `      channel: ${channelId} ${channel}`);
      }
      console.info('[Engine.execOrchestrator]', `    tasks:`);
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        console.info('[Engine.execOrchestrator]', `      task ${taskId}: ${task.schedule}ms ${task.enabled?'enabled':'disabled'}`);
      }
    }
    
    // re-schedule next execution
    task.timeout = setTimeout(this.execOrchestrator.bind(this), task.schedule, agentId, taskId);
  }

  async execTask(agentId: string, taskId: string) {
    console.log('[Engine.execTask]', `${agentId}/${taskId}`);

    // check assistant state
    if (this.state  !== 'running') {
      console.info('[Engine.execTask]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = this.agents[agentId];
    if (!agent) {
      console.info('[Engine.execTask]', `task ${taskId} skipped (agent not found)`);
      return;
    }
    // check if agent is enabled
    if (!agent.enabled) {
      console.info('[Engine.execTask]', `task ${taskId} skipped (agent disabled)`);
      return;
    }

    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      console.info('[Engine.execTask]', `task ${taskId} skipped (task not found)`);
      return;
    }
    // check if task is enabled
    if (!task.enabled) {
      console.info('[Engine.execTask]', `task ${taskId} skipped (task disabled)`);
      return;
    }

    const maxSteps = task.maxSteps || constants.DEFAULT_MAX_STEPS;

    // TODO: should tasks have cached chats? chatId = `task-${agentId}-${taskId}-${Date.now()}`;
    const chatId = undefined; // stateless, design choice, for not

    // set task input as user message to LLM
    const result = await this.execChat(task.input, chatId, agentId, maxSteps);
    if (!result) {
      console.error('[Engine.execTask]', `no result from sendMessage for agent ${agentId}`);
      return;
    }

    // send final result through configured channels
    for (const [channelId, groupId] of Object.entries(agent.channels)) {
      try {
        const channel = this.channels[channelId];

        // verify channel exists, warn if not, then skip
        if (!channel) {
          console.warn('[Engine.execTask]', `channel ${channelId} not found, skipping`);
          continue;
        }

        const reply = await channel.sendMessage({ role: 'assistant', content: result.content, channel: groupId } as Message);
        if (!reply.ok) {
          console.warn('[Engine.execTask]', `channel ${channelId} send failed, skipping`);
          continue;
        }

        // try to send, log error if failed, continue
        console.info('[Engine.execTask]', `message sent to channel ${channelId}:${groupId}`);
      } catch (err) {
        console.error('[Engine.execTask]', `channel ${channelId} send failed:`, err);
      }
    }

    if (this.isDry) {
      console.info('[Engine.execTask]', '[dry]', 'task executed (once)');
      return;
    }

    // re-schedule next execution
    task.timeout = setTimeout(this.execTask.bind(this), task.schedule, agentId, taskId);
  }

  async execReload() {
    console.log('[Engine.execReload]');
    this.state = 'reloading';

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

    this.state = 'running';
  }

  async  execTool(tool: string, args: any) : Promise<{[key:string]:any}> {
    console.debug('[Engine.execTool]', tool);

    const instance = this.tools[tool];
    if (!instance) {
      console.error('[Engine.execTool]', `tool ${tool} not found`);
      return {tool: tool, error: `tool ${tool} does NOT exist`};
    }

    return await instance.call(args);
  }

  async execChat(message: string, chatId: string | undefined, agentId: string, maxSteps: number = constants.DEFAULT_MAX_STEPS) : Promise<{content:string, steps:number} | null> {
    try {
      console.debug('[Engine.execChat]', chatId, agentId, message.slice(0, 100));

      // get chat from cache/store using sessionId
      const chat = this.cache.findChat(chatId);

      const agent = this.agents[agentId]!;

      // load agent IDENTITY.md as system message
      chat.messages.push({ role: 'system', content: agent.identity });

      // load task input as user message
      chat.messages.push({ role: 'user', content: message });

      // return early
      if (this.isDry) {
        console.info('[Engine.execChat]', '[dry]', 'send messages to:', agent.model.model);
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
        console.debug('[Engine.execChat]', `step=${steps}`, JSON.stringify(reply));

        // force stop
        if (reply.stop) {
          console.debug('[Engine.execChat]', `response force stop at step ${steps}`);
          break;
        }

        // execute any tool calls
        if (reply.message.tools && reply.message.tools.length > 0) {
          for (const tool of reply.message.tools) {
            console.debug('[Engine.execChat]', `executing tool: ${tool.name}`, JSON.stringify(tool.arguments));

            if (tool.name === constants.END_CHAT_NAME) {
              ender = true;
              break;
            }

            let result: any;
            try {
              const args = JSON.parse(tool.arguments);
              result = await this.execTool(tool.name, args);
            } catch (err) {
              console.error('[Engine.execChat]', `tool ${tool.name} failed:`, err);
              result = {error: (err as Error).message};
            }

            // add tool call to chat history
            chat.messages.push({ role: 'tool', content: JSON.stringify(result), toolId: tool.id });
          }
        }

        // if model produced content without pending tool calls, we're done
        // if (reply.message.content && (!reply.message.tools || reply.message.tools.length === 0)) {
        //   console.info('[Engine.execChat]', `response without tool calls, stopping the AI loop`);
        //   break;
        // }

        // if end_chat tool call is found, we're done
        if (ender) {
          console.info('[Engine.execChat]', `found ${constants.END_CHAT_NAME} tool call, stopping the AI loop`);
          break;
        }
      } while (steps < maxSteps - 1);

      // warn if max steps reached
      if (steps >= maxSteps) {
        console.warn('[Engine.execChat]', `max steps (${maxSteps}) reached for ${agentId}`);
      }

      // save chat to cache
      this.cache.saveChat(chatId, chat);

      // TODO: more info here
      return { content: reply?.message?.content || '', steps: steps };
    } catch (error) {
      console.error('[Engine.execChat]', error);
      return null;
    } 
  }
}
