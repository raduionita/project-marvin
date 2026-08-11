import { existsSync, readFileSync } from "fs";

import { listSystems } from "./systems";
import { Command, Config, Channel, Tool, Model, Agent, System, ToolMeta, Task, Message, Reply, Chat } from "./types";
import * as constants from './constants.js';
import { listTools } from "./tools/index.js";
import { listChannels } from "./channels/index.js";
import { listModels } from "./models/index.js";
import { join } from "path";
import { extractOutput } from "./helpers.js";

export default class Engine {
  public state: 'none' | 'load' | 'exec' | 'drop' = 'none';

  public config: Config = constants.DEFAULT_CONFIG as Config;

  private cache: Record<string, Chat> = {}; // chatId: chat

  // TODO: later consider moving browser, http, watch (file watcher) to a separate group "systems"
  public systems: Record<string, System> = {};

  // channels, models, agents
  public channels: Record<string, Channel> = {};
  public tools   : Record<string, Tool> = {};
  public models  : Record<string, Model> = {};
  public agents  : Record<string, Agent> = {};

  // workspace (~/.marvin) data folder
  public work: string = process.env.HOME + '/.marvin';
  // root (~/) app folder
  public root: string = import.meta.dirname.replace(/\/src.*/, '');

  public isDry: boolean = process.argv.includes('--dry') || process.argv.includes('-dry');
  public isTest: boolean = process.env.NODE_ENV === 'test' || process.env.BUN_TEST === '1';

  public get isDebug() { return process.env.MARVIN_LOG_LEVEL === 'debug'; }

  async load() {
    console.debug('[Engine.load]');

    if (this.state === 'load' || this.state === 'exec') {
      console.error('[Engine.load]', 'engine, already loaded');
      return;
    }

    await this.scanProject();
    await this.loadSystems();
    await this.loadTools();
    await this.loadChannels();
    await this.loadModels();
    await this.loadAgents();

    this.state = 'load';
  }

  async drop() {
    console.debug('[Engine.drop]');

    if (this.state !== 'load' && this.state !== 'exec') {
      console.error('[Engine.drop]', 'engine is not in the "exec" state, cannot stop');
      return;
    }

    this.state = 'drop';

    await this.dropAgents();
    await this.dropModels();
    await this.dropChannels();
    await this.dropSystems();

    // release all cached chats
    this.cache = {};

    this.state = 'none';
  }

  async exec() {
    console.debug('[Engine.exec]');

    // force load if not loaded
    if (this.state === 'none') {
      await this.load();
    }

    // continue only if loaded
    if (this.state !== 'load') {
      console.error('[Engine.exec]', 'engine is not in the "load" state, cannot exec');
      return;
    }

    // for each agent, for each task, start setTimeout
    for (const [agentId, agent] of Object.entries(this.agents)) {
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        if (this.isDry) {
          console.info('[Engine.execAgents]', `[dry] task ${taskId} scheduled (${task.schedule}ms) (agent ${agentId})`);
          continue;
        }

        // route each task to its handler by type
        let run: (agentId: string, taskId: string) => void;
        switch (task.type) {
          case 'monitor':
            run = this.execMonitor.bind(this);
            break;
          case 'sweep':
            run = this.execSweep.bind(this);
            break;
          case 'input':
          default:
            run = this.execInput.bind(this);
            break;
        }

        task.timeout = setTimeout(run, task.schedule, agentId, taskId);
        console.debug('[Engine.execAgents]', `task [${taskId}] (${task.type}) scheduled (${task.schedule}ms) (agent ${agentId})`);
      }
    }

    this.state = 'exec';
  }

  async scanProject() {
    console.debug('[Engine.scanProject]');

    // create project/workspace folder (~/.marvin)
    const hpath = this.work;
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
        if (this.systems[name]) continue;

        const Module = await import(`./systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          console.error('[Engine.loadSystems]', `"${name}" does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this);
        await instance.load();
        this.systems[name] = instance;
        console.info('[Engine.loadSystems]', `system "${name}" loaded`);
      } catch (err) {
        console.error('[Engine.loadSystems]', `failed to load "${name}":`, err);
      }
    }
  }

  async loadTools() {
    console.debug('[Engine.loadTools]');

    const files = listTools(this).map(f => f.replace('.ts', ''));
    for (const file of files) {
      const name = file;
      try {
        if (this.tools[name]) continue;

        const Module = await import(`./tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.error('[Engine.loadTools]', `"${file}" does not export a Tool class, skipping`);
          continue;
        }
        // register instance of Tool
        const instance = new Class(this);
        const meta = instance.meta as ToolMeta;
        this.tools[meta.function.name] = instance;
        console.info('[Engine.loadTools]', `tool "${meta.function.name}" loaded`);
      } catch (err) {
        console.error('[Engine.loadTools]', `failed to load "${file}":`, err);
      }
    }
  }

  async loadChannels() {
    console.debug('[Engine.loadChannels]');
    
    const files = listChannels(this).map(f => f.replace('.ts', ''));
    for (const [id, config] of Object.entries(this.config.channels)) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        console.error('[Engine.loadChannels]', `no file for channel "${id}", skipping`);
        continue;
      }

      try {
        if (this.channels[id]) continue;

        const Module = await import(`./channels/${file}.js`);
        const Class = Module.default;
        // must be a Channel class
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.error('[Engine.loadChannels]', `"${file}" does not export a Channel class, skipping ${id}`);
          continue;
        }
        // register instance of Channel 
        const instance = new Class(this);
        await instance.load();
        this.channels[id] = instance;
        console.info('[Engine.loadChannels]', `channel "${id}" loaded`);
      } catch (err) {
        console.error('[Engine.loadChannels]', `failed to load "${id}":`, err);
      }
    }
  }

  async loadModels() {
    console.debug('[Engine.loadModels]');

    // config models
    const files = listModels(this).map(f => f.replace('.ts', ''))
    for (const [modelId, config] of Object.entries(this.config.models)) {
      try {
        if (this.models[modelId]) continue;

        if (!config.enabled) {
          console.warn('[Engine.loadModels]', `model "${modelId}" is disabled, skipping`);
          continue;
        }

        const file = files.find(f => f === config.provider);
        if (!file) {
          console.error('[Engine.loadModels]', `no file for provider ${config.provider}, skipping "${modelId}"`);
          continue;
        }

        // import the model provider
        const Module = await import(`./models/${config.provider}.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          console.error('[Engine.loadModels]', `"${modelId}" does not export a Model class, skipping`);
          continue;
        }
        
        // save instance (needed by agents)
        const instance = new Class(this, config);
        this.models[modelId] = instance;

        console.info('[Engine.loadModels]', `model "${modelId}" loaded (${config.provider} ${config.model})`);
      } catch (err) {
        console.error('[Engine.loadModels]', `failed to load "${modelId}":`, err);
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
          console.error('[Engine.loadModels]', `"${modelId}" does not export a Model class!`);
          process.exit(1);
        }

        const instance = new Class(this, {provider: 'fallback', model: 'fallback'});
        this.models[modelId] = instance;

        // warn because fallback model is not a good idea, and does NOTHING
        console.info('[Engine.loadModels]', `model "${modelId}" fallback`);
      } catch (err) {
        console.error('[Engine.loadModels]', `failed to load "${modelId}":`, err);
      }
    }
  }

  async loadAgents() {
    console.debug('[Engine.loadAgents]');

    // type: orchestrator/supervisor
    if (!this.agents[this.config.settings.name]) {
      const marvinId = this.config.settings.name;
      
      // model: default or first
      const model = Object.values(this.models).find(m => m.enabled && m.default) || this.models[Object.keys(this.models)[0] as string]!;

      // load agent system prompt (~/.marvin/IDENTITY.md)
      let identity = constants.MARVIN_MD;
      if (existsSync(join(this.work, 'MARVIN.md'))) {
        identity = readFileSync(join(this.work, 'MARVIN.md'), 'utf8').trim();
      } else {
        console.warn('[Engine.loadAgents]', `no MARVIN.md found for agent "${marvinId}", using default`);
      }

      // add format to input
      identity += '\n\n' + constants.JSON_MD;
      
      // add ochestrator agent
      this.agents[marvinId] = {
        id: marvinId,
        enabled: true,
        identity: identity,
        channels: {},
        model: model,
        tasks: {},
      } as Agent;

      // add monitor task (state/health check) to the orchestrator agent
      this.agents[marvinId].tasks['monitor'] = {
        id: 'monitor',
        enabled: true,
        type: 'monitor',
        schedule: 60*60*1000,
        timeout: null,
        maxSteps: 0,
      } as Task;

      console.info('[Engine.loadAgents]', `task "monitor" created (agent ${marvinId})`);

      // add sweep task (evict idle cached chats) to the orchestrator agent
      this.agents[marvinId].tasks['sweep'] = {
        id: 'sweep',
        enabled: true,
        type: 'sweep',
        schedule: constants.CHAT_SWEEP_MS,
        timeout: null,
        maxSteps: 0,
      } as Task;

      console.info('[Engine.loadAgents]', `task "sweep" created (agent ${marvinId})`);

      console.info('[Engine.loadAgents]',`agent "${marvinId}" loaded`);
    }

    // type: agent
    for (const [agentId, agent] of Object.entries(this.config.agents)) {
      if (this.agents[agentId]) continue;

      const model = this.models[agent.model || ''];
      if (!model) {
        console.error('[Engine.loadAgents]', `model not found for agent "${agentId}": ${agent.model}`);
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
        } else if (input && existsSync(input)) {
          readFileSync(input, 'utf8').trim();
        } else if (existsSync(join(this.work, 'agents', agentId, 'tasks', taskId, `TASK.md`))) {
          input = readFileSync(join(this.work, 'agents', agentId, 'tasks', taskId, `TASK.md`), 'utf8').trim();
        }

        if (!input) {
          console.warn('[Engine.loadAgents]', `no input found for task "${taskId}", disabling`);
          enabled = false;
        }

        if (this.isDry) {
          console.info('[Engine.loadAgents]', `[dry] task "${taskId}" created (agent ${agentId})`);
          continue;
        }

        // add task to agent
        tasks[taskId] = {
          id: taskId,
          enabled: enabled,
          type: task.type || 'input',
          schedule: schedule,
          timeout: null,
          maxSteps: task.maxSteps,
          format: task.format || 'json',
          schema: task.schema || constants.DEFAULT_SCHEMA,
          input: input,
        } as Task;

        console.info('[Engine.loadAgents]', `task "${taskId}" created (agent ${agentId})`);
      }

      // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
      let identity = constants.IDENTITY_MD;
      if (existsSync(join(this.work, 'agents', agentId, 'IDENTITY.md'))) {
        identity = readFileSync(join(this.work, 'agents', agentId, 'IDENTITY.md'), 'utf8').trim();
      } else {
        console.warn('[Engine.loadAgents]', `no IDENTITY.md found for agent "${agentId}", using default`);
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

  async dropAgents() {
    console.debug('[Engine.dropAgents]');
    for (const [agentId, agent] of Object.entries(this.agents)) {
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        if (task.timeout) { 
          console.debug('[Engine.dropAgents]', `stopping task ${taskId}`);
          clearTimeout(task.timeout);
        } else {
          console.debug('[Engine.dropAgents]', `task ${taskId} not running, continuing`);
        }
      }
    }
    this.agents = {};
  }

  async dropModels() {
    console.debug('[Engine.dropModels]');
    this.models = {};
  }

  // will detach and delete ALL channels from the engine
  async dropChannels() {
    console.debug('[Engine.dropChannels]');
    for (const [channelId, channel] of Object.entries(this.channels)) {
      try {
        console.debug('[Engine.dropChannels]', `detaching channel ${channelId}`);
        await channel.drop();
      } catch (err) {
        console.error('[Engine.dropChannels]', `error detaching channel:`, err);
      }
    }
    this.channels = {};
  }

  // will detach and delete the channel from the engine
  async dropChannel(id: string) {
    console.debug('[Engine.dropChannel]', id);
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
    console.debug('[Engine.dropSystems]');
    for (const [name, system] of Object.entries(this.systems)) {
      try {
        console.debug('[Engine.dropSystems]', `detaching system ${name}`);
        await system.drop();
      } catch (err) {
        console.error('[Engine.dropSystems]', `error detaching system:`, err);
      }
    }
    this.systems = {};
  }

  // for each agent, for each task, start setTimeout

  // monitors the state: checks agents and tasks, then reschedules itself
  async execMonitor(agentId: string, taskId: string) {
    console.debug('[Engine.execMonitor]', agentId, taskId);

    // check assistant state
    if (this.state  !== 'exec') {
      console.info('[Engine.execMonitor]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = this.agents[agentId];
    if (!agent) {
      console.error('[Engine.execMonitor]', `agent ${agentId} NOT found`);
      return;
    }
    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      console.error('[Engine.execMonitor]', `task ${taskId} NOT found`);
      return;
    }
    
    // log agents and their tasks
    console.info('[Engine.execMonitor]', `marvin agents:`);
    for (const [agentId, agent] of Object.entries(this.agents)) {
      console.info('[Engine.execMonitor]', `  agent ${agentId}:`);
      console.info('[Engine.execMonitor]', `    enabled: ${agent.enabled?'yes':'no'}`);
      console.info('[Engine.execMonitor]', `    model: ${agent.model.model}`);
      console.info('[Engine.execMonitor]', `    channels:`);
      for (const [channelId, channel] of Object.entries(agent.channels)) {
        console.info('[Engine.execMonitor]', `      channel: ${channelId} ${channel}`);
      }
      console.info('[Engine.execMonitor]', `    tasks:`);
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        console.info('[Engine.execMonitor]', `      task ${taskId}: ${task.schedule}ms ${task.enabled?'enabled':'disabled'}`);
      }
    }
    
    // re-schedule next execution
    task.timeout = setTimeout(this.execMonitor.bind(this), task.schedule, agentId, taskId);
  }

  // prompts the LLM with the task input, sends the result through channels, then reschedules
  async execInput(agentId: string, taskId: string) {
    console.debug('[Engine.execInput]', `${agentId}/${taskId}`);

    // check assistant state
    if (this.state !== 'exec') {
      console.warn('[Engine.execInput]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = this.agents[agentId];
    if (!agent) {
      console.info('[Engine.execInput]', `task ${taskId} skipped (agent not found)`);
      return;
    }
    // check if agent is enabled
    if (!agent.enabled) {
      console.info('[Engine.execInput]', `task ${taskId} skipped (agent disabled)`);
      return;
    }

    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      console.info('[Engine.execInput]', `task ${taskId} skipped (task not found)`);
      return;
    }
    // check if task is enabled
    if (!task.enabled) {
      console.info('[Engine.execInput]', `task ${taskId} skipped (task disabled)`);
      return;
    }

    if (!task.input) {
      console.info('[Engine.execInput]', `task ${taskId} skipped (no input)`);
      return;
    }

    const maxSteps = task.maxSteps || constants.DEFAULT_MAX_STEPS;

    // TODO: should tasks have cached chats? chatId = `task-${agentId}-${taskId}-${Date.now()}`;
    const chatId = undefined; // stateless, design choice, for not

    const format = task.format || 'json';
    const schema = task.schema || constants.DEFAULT_SCHEMA;

    // set task input as user message to LLM
    const result = await this.execChat(chatId, agentId, task.input, format, schema, maxSteps);
    if (!result) {
      console.error('[Engine.execInput]', `no result from sendMessage for agent ${agentId}`);
      return;
    }

    // extract "output" from result json 
    const content = extractOutput(result.content);
    // send final result through configured channels
    for (const [channelId, groupId] of Object.entries(agent.channels)) {
      try {
        const channel = this.channels[channelId];

        // verify channel exists, warn if not, then skip
        if (!channel) {
          console.warn('[Engine.execInput]', `channel ${channelId} not found, skipping`);
          continue;
        }

        const reply = await channel.sendMessage({ role: 'assistant', content, channel: groupId } as Message);
        if (!reply.ok) {
          console.warn('[Engine.execInput]', `channel ${channelId} send failed, skipping`);
          continue;
        }

        // try to send, log error if failed, continue
        console.info('[Engine.execInput]', `message sent to channel ${channelId}:${groupId}`);
      } catch (err) {
        console.error('[Engine.execInput]', `channel ${channelId} send failed:`, err);
      }
    }

    if (this.isDry) {
      console.info('[Engine.execInput]', '[dry]', 'task executed (once)');
      return;
    }

    // re-schedule next execution
    task.timeout = setTimeout(this.execInput.bind(this), task.schedule, agentId, taskId);
  }

  async execReload() {
    console.debug('[Engine.execReload]');

    // drop in reverse order
    await this.drop();
    // re-load & in dependency order and exec
    await this.exec();
  }

  // tool call
  async  execTool(tool: string, args: {[key:string]:any}) : Promise<{[key:string]:any}> {
    console.debug('[Engine.execTool]', tool);

    const instance = this.tools[tool];
    if (!instance) {
      console.error('[Engine.execTool]', `tool ${tool} not found`);
      return {tool: tool, error: `tool ${tool} does NOT exist`};
    }

    try {
      // ! tool call
      return await instance.call(args);
    } catch (err) {
      console.error('[Engine.execTool]', `tool ${tool} failed:`, err);
      return {tool: tool, error: (err as Error).message};
    }
  }

  // save chat to cache
  saveChat(chatId: string | undefined, chat: Chat): void {
    if (!chatId) return;
    chat.updatedAt = Date.now();
    this.cache[chatId] = chat;
  }

  // find cached chat by id
  findChat(chatId: string | undefined): Chat | null {
    if (!chatId) return null;
    const chat = this.cache[chatId] as Chat || null;
    if (chat) chat.updatedAt = Date.now();
    return chat;
  }

  // bound chat history to the system message + the last N messages
  trimChat(chat: Chat): void {
    if (!chat.messages || chat.messages.length <= constants.MAX_CHAT_MESSAGES) return;

    // drop the oldest messages, always keeping the system message (index 0)
    const drop = chat.messages.length - constants.MAX_CHAT_MESSAGES;
    if (chat.messages[0]?.role === 'system') {
      chat.messages = [chat.messages[0]!, ...chat.messages.slice(drop + 1)];
    } else {
      chat.messages = chat.messages.slice(drop);
    }
  }

  // removes cached chats idle for longer than the TTL, then reschedules itself
  async execSweep(agentId: string, taskId: string) {
    console.debug('[Engine.execSweep]', `${agentId}/${taskId}`);

    // check assistant state
    if (this.state !== 'exec') {
      console.info('[Engine.execSweep]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = this.agents[agentId];
    if (!agent) {
      console.info('[Engine.execSweep]', `task ${taskId} skipped (agent not found)`);
      return;
    }
    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      console.info('[Engine.execSweep]', `task ${taskId} skipped (task not found)`);
      return;
    }

    // remove cached chats idle for longer than the TTL
    const now = Date.now();
    let removed = 0;
    for (const [chatId, chat] of Object.entries(this.cache)) {
      if (now - (chat.updatedAt || 0) > constants.CHAT_TTL_MS) {
        console.debug('[Engine.execSweep]', `removing idle chat ${chatId}`);
        delete this.cache[chatId];
        removed++;
      }
    }
    console.info('[Engine.execSweep]', `removed ${removed} idle chat(s)`);

    if (this.isDry) {
      console.info('[Engine.execSweep]', '[dry]', 'task executed (once)');
      return;
    }

    // re-schedule next execution
    task.timeout = setTimeout(this.execSweep.bind(this), task.schedule, agentId, taskId);
  }

  // agent loop
  async execChat(chatId: string | undefined, agentId: string, message: string, format: 'text' | 'json' = 'json', schema: {[key:string]:string} = constants.DEFAULT_SCHEMA, maxSteps: number = constants.DEFAULT_MAX_STEPS) : Promise<{content:string, steps:number} | null> {
    try {
      console.debug('[Engine.execChat]', chatId, agentId, message.slice(0, 100));

      const agent = this.agents[agentId]!;

      // get chat from cache/store using chatId
      let chat = this.findChat(chatId);
      if (!chat) {
        chat = { id: chatId, messages: [], thinking: false, userId: '', format: 'text', updatedAt: Date.now() } as Chat;

        let system = agent.identity;

        if (format === 'json') {
          chat.format = 'json';
          system += '\n\n' + constants.JSON_MD;
          system += '\n' + JSON.stringify(schema);
        }

        // load agent IDENTITY.md as system message
        chat.messages.push({ role: 'system', content: system });
      }

      // load task input as user message
      chat.messages.push({ role: 'user', content: message.trim() });

      // return early
      if (this.isDry) {
        console.info('[Engine.execChat]', '[dry]', 'send messages to:', agent.model.model);
        this.saveChat(chatId, chat);
        return { content: '(dry)', steps: 0 };
      }

      // TODO this needs a type, Model.chat should return a proper Reply/Response/Result type
      let reply: Reply;

      // AI loop: call model, execute tool calls, repeat until done
      let steps = -1;
      let ender = false;
      do {
        steps++;

        // keep the chat history bounded (system message + last N messages)
        this.trimChat(chat);

        // ! AI call // core of the AI loop: call model, execute tool calls, repeat until done
        reply = await agent.model.sendChat(chat);

        // persist assistant reply to chat history
        chat.messages.push({ role: 'assistant', content: reply.message.content?.trim() || '', tools: reply.message.tools });

        // trim result, this can be really big
        console.debug('[Engine.execChat]', `step=${steps}`, JSON.stringify(reply));

        // force stop
        if (reply.stop) {
          console.debug('[Engine.execChat]', `response force stop at step ${steps}`);
          break;
        }

        // execute any tool calls
        for (const tool of reply.message.tools || []) {
          console.debug('[Engine.execChat]', `executing tool: ${tool.name}`, JSON.stringify(tool.arguments));

          if (tool.name === constants.END_CHAT_NAME) {
            ender = true;
            break;
          }

          // ! tool call
          let result = await this.execTool(tool.name, tool.arguments);

          // add tool call to chat history
          chat.messages.push({ role: 'tool', content: JSON.stringify(result), toolId: tool.id });
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
      this.saveChat(chatId, chat);

      // TODO: more info here
      return { content: reply?.message?.content || '', steps: steps };
    } catch (error) {
      console.error('[Engine.execChat]', error);
      return null;
    } 
  }
}
