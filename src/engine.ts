import { join } from "path";
import { existsSync, readFileSync, unlinkSync } from "fs";

import logger from './logger.js';
import { listSystems, loadSystem } from "./systems";
import { Command, Config, Channel, Tool, Model, System, Task, Message, Integration, Skill, ToolMeta } from "./types";
import { Agent } from './agent.js';
import * as constants from './constants.js';
import { listInternalTools, listCustomTools } from "./tools/index.js";
import { listChannels } from "./channels/index.js";
import { listIntegrations } from "./integrations/index.js";
import { Mcp } from "./mcp";
import { listSkills, loadSkill } from "./skills/index.js";
import { listModels } from "./models/index.js";

export default class Engine {
  public state: 'none' | 'load' | 'exec' | 'drop' = 'none';

  public config: Config = constants.DEFAULT_CONFIG as Config;

  // TODO: later consider moving browser, http, watch (file watcher) to a separate group "systems"
  public systems: Record<string, System> = {};

  // channels, models, agents
  public channels: Record<string, Channel> = {};
  public models  : Record<string, Model> = {};
  public agents  : Record<string, Agent> = {};
  public tasks   : Record<string, Task> = {};
  
  public skills      : Record<string, Skill> = {};
  public tools       : Record<string, Tool> = {};
  public mcps        : Record<string, Mcp> = {};
  public integrations: Record<string, Integration> = {};

  // workspace (~/.marvin) data folder
  public work: string = process.env.HOME + '/.marvin';
  // root (~/) app folder
  public root: string = import.meta.dirname.replace(/\/src.*/, '');

  public isTest: boolean = process.env.NODE_ENV === 'test' || process.env.BUN_TEST === '1';
  public isDebug: boolean =  process.env.MARVIN_LOG_LEVEL === 'debug';

  async load() {
    logger.debug('[Engine.load]');

    if (this.state === 'load' || this.state === 'exec') {
      logger.error('[Engine.load]', 'engine, already loaded');
      return;
    }

    await this.scanProject();
    await this.loadSystems();
    await this.loadTools();
    await this.loadChannels();
    await this.loadIntegrations();
    await this.loadMcps();
    await this.loadSkills();
    await this.loadModels();
    await this.loadAgents();
    await this.loadTasks();

    this.state = 'load';
  }

  async drop() {
    logger.debug('[Engine.drop]');

    if (this.state !== 'load' && this.state !== 'exec') {
      logger.error('[Engine.drop]', 'engine is not in the "exec" state, cannot stop');
      return;
    }

    this.state = 'drop';

    await this.dropAgents();
    await this.dropTasks();
    await this.dropModels();
    await this.dropChannels();
    await this.dropIntegrations();
    await this.dropMcps();
    await this.dropSkills();
    await this.dropSystems();

    this.state = 'none';
  }

  async exec() {
    logger.debug('[Engine.exec]', '----------------------------------------------------------------');
    logger.debug('[Engine.exec]', 'state:', this.state);

    // force load if not loaded
    if (this.state === 'none') {
      await this.load();
    }

    // continue only if loaded
    if (this.state !== 'load') {
      logger.error('[Engine.exec]', 'engine is not in the "load" state, cannot exec');
      return;
    }

    // for each task, start setTimeout
    for (const [taskId, task] of Object.entries(this.tasks)) {
      // route each task to its handler by type
      let run: (taskId: string) => void;
      switch (task.type) {
        case 'monitor':
          run = this.execMonitor.bind(this);
          break;
        case 'sweep':
          run = this.execSweep.bind(this);
          break;
        case 'task':
        default:
          run = this.execTask.bind(this);
          break;
      }

      task.timeout = setTimeout(run, task.schedule, taskId);
      logger.debug('[Engine.execAgents]', `task [${taskId}] (${task.type}) scheduled (${task.schedule}ms) (agent ${task.agent?.id})`);
    }

    this.state = 'exec';
  }

  async scanProject() {
    logger.debug('[Engine.scanProject]');

    // create project/workspace folder (~/.marvin)
    const hpath = this.work;
    if (!existsSync(hpath)) {
      logger.error('[Engine.scanProject]', `missing ${hpath} folder`, 'please run "marvin install" again');
      return;
    }

    // agents folder (~/.marvin/agents)
    const apath = join(hpath, 'agents');
    if (!existsSync(apath)) {
      logger.error('[Engine.scanProject]', `missing ${apath} folder`, 'please run "marvin install" again');
      return;
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(hpath, 'MARVIN.md');
    if (!existsSync(mpath)) {
      logger.error('[Engine.scanProject]', `missing ${mpath} file`, 'please run "marvin install" again');
      return;
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (!existsSync(cpath)) {
      logger.error('[Engine.scanProject]', `missing ${cpath} file`, 'please run "marvin install" again');
      return;
    }
  }

  async loadSystems() {
    logger.debug('[Engine.loadSystems]', 'loading systems...');

    const files = listSystems(this);
    for (const name of files) {
      try {
        if (this.systems[name]) continue;
        // register instance of System
        const instance = await loadSystem(this, name);
        await instance.load();
        this.systems[name] = instance;
        logger.info('[Engine.loadSystems]', `system "${name}" loaded`);
      } catch (err) {
        logger.error('[Engine.loadSystems]', `failed to load "${name}":`, err);
      }
    }

    logger.debug('[Engine.loadSystems]', `[${Object.keys(this.systems).join(',')}]`);
  }

  async loadTools() {
    logger.debug('[Engine.loadTools]', 'loading internal tools...');

    const files = listInternalTools(this);
    for (const file of files) {
      const name = file;
      try {
        if (this.tools[name]) continue;

        const Module = await import(`./tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          logger.error('[Engine.loadTools]', `"${file}" does not export a Tool class, skipping`);
          continue;
        }

        // register instance of Tool
        const instance = new Class(this);
        const meta = instance.meta as ToolMeta;
        this.tools[meta.function.name] = instance;
        logger.info('[Engine.loadTools]', `tool "${meta.function.name}" loaded`);
      } catch (err) {
        logger.error('[Engine.loadTools]', `failed to load "${file}":`, err);
      }
    }

    // custom tools in the workspace (~/.marvin/tools)
    const cdir = join(this.work, 'tools');
    const cfiles = listCustomTools(this);
    for (const file of cfiles) {
      const name = file.replace('.ts', '');
      try {
        if (this.tools[name]) continue;

        const Module = await import(join(cdir, file));
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          logger.error('[Engine.loadTools]', `"${file}" does not export a Tool class, skipping`);
          continue;
        }

        // register instance of Tool
        const instance = new Class(this);
        const meta = instance.meta as ToolMeta;
        this.tools[meta.function.name] = instance;
        logger.info('[Engine.loadTools]', `tool "${meta.function.name}" loaded (custom)`);
      } catch (err) {
        logger.error('[Engine.loadTools]', `failed to load custom tool "${file}":`, err);
      }
    }

    logger.debug('[Engine.loadTools]', `[${Object.keys(this.tools).join(',')}]`);
  }

  async loadChannels() {
    logger.debug('[Engine.loadChannels]', 'loading channels...');
    
    const files = listChannels(this);
    for (const [id, config] of Object.entries(this.config.channels)) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        logger.error('[Engine.loadChannels]', `no file for channel "${id}", skipping`);
        continue;
      }

      try {
        if (this.channels[id]) continue;

        const Module = await import(`./channels/${file}.js`);
        const Class = Module.default;
        // must be a Channel class
        if (!Class || !(Class.prototype instanceof Channel)) {
          logger.error('[Engine.loadChannels]', `"${file}" does not export a Channel class, skipping ${id}`);
          continue;
        }
        // register instance of Channel 
        const instance = new Class(this);
        await instance.load();
        this.channels[id] = instance;
        logger.info('[Engine.loadChannels]', `channel "${id}" loaded`);
      } catch (err) {
        logger.error('[Engine.loadChannels]', `failed to load "${id}":`, err);
      }
    }

    logger.debug('[Engine.loadChannels]', `[${Object.keys(this.channels).join(',')}]`);
  }

  async loadIntegrations() {
    logger.debug('[Engine.loadIntegrations]', 'loading integrations...');

    const files = listIntegrations(this);
    for (const [id, config] of Object.entries(this.config.integrations)) {
      if (!config.enabled) continue;

      const file = files.find(f => f === config.type);
      if (!file) {
        logger.error('[Engine.loadIntegrations]', `no file for integration "${id}" type "${config.type}", skipping`);
        continue;
      }

      try {
        if (this.integrations[id]) continue;

        const Module = await import(`./integrations/${file}.js`);
        const Class = Module.default;
        // must be an Integration class
        if (!Class || !(Class.prototype instanceof Integration)) {
          logger.error('[Engine.loadIntegrations]', `"${id}" does not export an Integration class, skipping`);
          continue;
        }
        // register instance of Integration
        const instance = new Class(this, config);
        await instance.load();
        this.integrations[id] = instance;
        logger.info('[Engine.loadIntegrations]', `integration "${id}" loaded`);
      } catch (err) {
        logger.error('[Engine.loadIntegrations]', `failed to load "${id}":`, err);
      }
    }

    // tools may derive meta from loaded integrations (e.g. call_integration
    // lists the actual sites and tools), so refresh them after loading
    for (const tool of Object.values(this.tools)) {
      const refresh = (tool as { refresh?: () => void }).refresh;
      if (typeof refresh === 'function') refresh.call(tool);
    }

    logger.debug('[Engine.loadIntegrations]', `[${Object.keys(this.integrations).join(',')}]`);
  }

  // connects the configured mcp servers (spawn + initialize)
  async loadMcps() {
    logger.debug('[Engine.loadMcps]', 'loading mcps...');

    for (const [id, config] of Object.entries(this.config.mcps || {})) {
      if (!config.enabled) continue;

      try {
        if (this.mcps[id]) continue;
        const mcp = new Mcp(this, id, config);
        await mcp.load();
        this.mcps[id] = mcp;
      } catch (err) {
        logger.error('[Engine.loadMcps]', `failed to connect mcp "${id}":`, err);
      }
    }

    logger.debug('[Engine.loadMcps]', 'mcps:', `[${Object.keys(this.mcps).join(',')}]`);
  }

  async loadSkills() {
    logger.debug('[Engine.loadSkills]', 'loading skills...');

    // default skills shipped with marvin (src/skills), overridden by
    // custom workspace skills (~/.marvin/skills)
    const skills = listSkills(this);
    for (const id of skills) {
      try {
        const skill = loadSkill(this, id);
        this.skills[skill.id] = skill;
        logger.info('[Engine.loadSkills]', `skill "${skill.id}" loaded (${skill.source})`);
      } catch (err) {
        logger.error('[Engine.loadSkills]', `failed to load "${id}":`, err);
      }
    }

    logger.debug('[Engine.loadSkills]', `[${Object.keys(this.skills).join(',')}]`);
  }

  async loadModels() {
    logger.debug('[Engine.loadModels]', 'loading models...');

    // config models
    const files = listModels(this);
    for (const [modelId, config] of Object.entries(this.config.models)) {
      try {
        if (this.models[modelId]) continue;

        if (!config.enabled) {
          logger.warn('[Engine.loadModels]', `model "${modelId}" is disabled, skipping`);
          continue;
        }

        const file = files.find(f => f === config.provider);
        if (!file) {
          logger.error('[Engine.loadModels]', `no file for provider ${config.provider}, skipping "${modelId}"`);
          continue;
        }

        // import the model provider
        const Module = await import(`./models/${config.provider}.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          logger.error('[Engine.loadModels]', `"${modelId}" does not export a Model class, skipping`);
          continue;
        }
        
        // save instance (needed by agents)
        const instance = new Class(this, config);
        this.models[modelId] = instance;

        logger.info('[Engine.loadModels]', `model "${modelId}" loaded (${config.provider} ${config.model})`);
      } catch (err) {
        logger.error('[Engine.loadModels]', `failed to load "${modelId}":`, err);
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
          logger.error('[Engine.loadModels]', `"${modelId}" does not export a Model class!`);
          process.exit(1);
        }

        const instance = new Class(this, {provider: 'fallback', model: 'fallback'});
        this.models[modelId] = instance;

        // warn because fallback model is not a good idea, and does NOTHING
        logger.info('[Engine.loadModels]', `model "${modelId}" fallback`);
      } catch (err) {
        logger.error('[Engine.loadModels]', `failed to load "${modelId}":`, err);
      }
    }

    logger.debug('[Engine.loadModels]', `[${Object.keys(this.models).join(',')}]`);
  }

  async loadAgents() {
    logger.debug('[Engine.loadAgents]', 'loading agents...');

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
        logger.warn('[Engine.loadAgents]', `no MARVIN.md found for agent "${marvinId}", using default`);
      }

      // add ochestrator agent
      this.agents[marvinId] = new Agent(this, {
        id: marvinId,
        enabled: true,
        memory: this.config.settings.memory,
        identity: identity,
        channels: {},
        model: model,
      });

      logger.info('[Engine.loadAgents]',`agent "${marvinId}" loaded`);
    }

    // type: agent
    for (const [agentId, agent] of Object.entries(this.config.agents)) {
      if (this.agents[agentId]) continue;

      const model = this.models[agent.model || ''];
      if (!model) {
        logger.error('[Engine.loadAgents]', `model not found for agent "${agentId}": ${agent.model}`);
        continue;
      }

      // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
      let identity = constants.IDENTITY_MD;
      if (existsSync(join(this.work, 'agents', agentId, 'IDENTITY.md'))) {
        identity = readFileSync(join(this.work, 'agents', agentId, 'IDENTITY.md'), 'utf8').trim();
      } else {
        logger.warn('[Engine.loadAgents]', `no IDENTITY.md found for agent "${agentId}", using default`);
      }

      this.agents[agentId] = new Agent(this, {
        id: agentId,
        enabled: agent.enabled,
        memory: this.config.settings.memory,
        identity: identity,
        channels: agent.channels,
        model: model,
      });

      logger.info('[Engine.loadAgents]',`agent "${agentId}" loaded`);
    }

    logger.debug('[Engine.loadAgents]', 'agents:', Object.keys(this.agents));
  }

  // loads tasks: the internal monitor/sweep tasks run on the orchestrator
  // agent, config tasks run on the agent referenced by task.agent
  async loadTasks() {
    logger.debug('[Engine.loadTasks]', 'loading tasks...');

    const marvinId = this.config.settings.name;
    const marvin = this.agents[marvinId];

    // internal tasks: monitor (state/health check) + sweep (evict idle chats)
    if (marvin) {
      this.tasks['monitor'] = {
        id: 'monitor',
        enabled: true,
        type: 'monitor',
        agent: marvin,
        schedule: constants.MONITOR_TASK_MS,
        timeout: null,
        maxSteps: 0,
        input: 'monitor',
      } as Task;

      this.tasks['sweep'] = {
        id: 'sweep',
        enabled: true,
        type: 'sweep',
        agent: marvin,
        schedule: constants.SWEEP_TASK_MS,
        timeout: null,
        maxSteps: 0,
        input: 'sweep',
      } as Task;

      logger.info('[Engine.loadTasks]', `tasks "monitor" and "sweep" created (agent ${marvinId})`);
    }

    // config tasks
    for (const [taskId, task] of Object.entries(this.config.tasks || {})) {
      const agent = this.agents[task.agent || marvinId];
      if (!agent) {
        logger.error('[Engine.loadTasks]', `agent not found for task "${taskId}": ${task.agent || marvinId}, skipping`);
        continue;
      }

      let schedule = 1000 < task.schedule ? task.schedule : task.schedule * 1000;
      let enabled = task.enabled;

      // task input: string prompt, file path, or TASK.md in the workspace
      let input = task.input;
      if (input && !input.endsWith('.md')) {
        // continue as is, input is a string
      } else if (input && existsSync(input)) {
        input = readFileSync(input, 'utf8').trim();
      } else if (existsSync(join(this.work, 'tasks', taskId, 'TASK.md'))) {
        input = readFileSync(join(this.work, 'tasks', taskId, 'TASK.md'), 'utf8').trim();
      }

      if (!input) {
        logger.warn('[Engine.loadTasks]', `no input found for task "${taskId}", disabling`);
        enabled = false;
      }

      // add task to the engine
      this.tasks[taskId] = {
        id: taskId,
        enabled: enabled,
        type: task.type || 'task',
        agent: agent,
        schedule: schedule,
        timeout: null,
        input: input,
      } as Task;

      logger.info('[Engine.loadTasks]', `task "${taskId}" created (agent ${agent.id})`);
    }

    logger.debug('[Engine.loadTasks]', `[${Object.keys(this.tasks).join(',')}]`);
  }

  async dropAgents() {
    logger.debug('[Engine.dropAgents]', 'dropping agents...');
    this.agents = {};
    logger.debug('[Engine.dropAgents]', 'done');
  }

  async dropTasks() {
    logger.debug('[Engine.dropTasks]', 'dropping tasks...');
    for (const [taskId, task] of Object.entries(this.tasks)) {
      if (task.timeout) {
        logger.debug('[Engine.dropTasks]', `stopping task ${taskId}`);
        clearTimeout(task.timeout);
      } else {
        logger.debug('[Engine.dropTasks]', `task ${taskId} not running, continuing`);
      }
    }
    this.tasks = {};
  }

  async dropModels() {
    logger.debug('[Engine.dropModels]', 'dropping models...');
    this.models = {};
    logger.debug('[Engine.dropModels]', 'done');
  }

  async dropSkills() {
    logger.debug('[Engine.dropSkills]', 'dropping skills...');
    this.skills = {};
  }

  async dropIntegrations() {
    logger.debug('[Engine.dropIntegrations]', 'dropping integrations...');
    this.integrations = {};
  }

  // will detach and delete ALL channels from the engine
  async dropChannels() {
    logger.debug('[Engine.dropChannels]', 'dropping channels...');
    for (const [channelId, channel] of Object.entries(this.channels)) {
      try {
        logger.debug('[Engine.dropChannels]', `detaching channel ${channelId}`);
        await channel.drop();
      } catch (err) {
        logger.error('[Engine.dropChannels]', `error detaching channel:`, err);
      }
    }
    this.channels = {};
  }

  // will detach and delete the channel from the engine
  async dropChannel(id: string) {
    logger.debug('[Engine.dropChannel]', id);
    if (this.channels[id]) {
      try {
        this.channels[id].drop();
      } catch (err) {
        logger.error('[Engine.dropChannel]', `error detaching channel:`, err);
      }
      delete this.channels[id];
    }
  }

  async dropIntegration(id: string) {
    logger.debug('[Engine.dropIntegration]', id);
    delete this.integrations[id];
  }

  // disconnects all mcp servers (kills their processes)
  async dropMcps() {
    logger.debug('[Engine.dropMcps]', 'dropping mcps...');
    for (const [id, client] of Object.entries(this.mcps)) {
      try {
        logger.debug('[Engine.dropMcps]', `disconnecting mcp ${id}`);
        await client.drop();
      } catch (err) {
        logger.error('[Engine.dropMcps]', `error disconnecting mcp ${id}:`, err);
      }
    }
    this.mcps = {};
  }

  // disconnect and remove a single mcp server from the engine
  async dropMcp(id: string) {
    logger.debug('[Engine.dropMcp]', id);
    const client = this.mcps[id];
    if (client) {
      try {
        await client.drop();
      } catch (err) {
        logger.error('[Engine.dropMcp]', `error disconnecting mcp ${id}:`, err);
      }
      delete this.mcps[id];
    }
  }

  async dropSystems() {
    logger.debug('[Engine.dropSystems]', 'dropping systems...');
    for (const [name, system] of Object.entries(this.systems)) {
      try {
        logger.debug('[Engine.dropSystems]', `detaching system ${name}`);
        await system.drop();
      } catch (err) {
        logger.error('[Engine.dropSystems]', `error detaching system:`, err);
      }
    }
    this.systems = {};
  }

  // drop and re-exec the engine
  async execReload() {
    logger.debug('[Engine.execReload]');

    // drop in reverse order
    await this.drop();
    // re-load & in dependency order and exec
    await this.exec();
  }

  // for each agent, for each task, start setTimeout

  // monitors the state: checks agents and tasks, then reschedules itself
  async execMonitor(taskId: string) {
    logger.debug('[Engine.execMonitor]', taskId);

    // check assistant state
    if (this.state !== 'exec') {
      logger.info('[Engine.execMonitor]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if task exists
    const task = this.tasks[taskId];
    if (!task) {
      logger.error('[Engine.execMonitor]', `task ${taskId} NOT found`);
      return;
    }
    
    // log agents and their tasks
    logger.info('[Engine.execMonitor]', `agents:`);
    for (const [agentId, agent] of Object.entries(this.agents)) {
      logger.info('[Engine.execMonitor]', `  ${agentId}:`);
      logger.info('[Engine.execMonitor]', `  - enabled: ${agent.enabled?'yes':'no'}`);
      logger.info('[Engine.execMonitor]', `  - model: ${agent.model.model}`);
      logger.info('[Engine.execMonitor]', `  - channels: ${Object.keys(agent.channels)}`);
    }

    logger.info('[Engine.execMonitor]', `tasks:`);
    for (const [taskId, task] of Object.entries(this.tasks)) {
      logger.info('[Engine.execMonitor]', `  ${taskId}`);
      logger.info('[Engine.execMonitor]', `  - agent: ${task.agent?.id}`);
      logger.info('[Engine.execMonitor]', `  - input: ${task.input?.slice(0, 32)}`);
      logger.info('[Engine.execMonitor]', `  - schedule: ${task.schedule}ms`);
    }
    
    // re-schedule next execution
    task.timeout = setTimeout(this.execMonitor.bind(this), task.schedule, taskId);
  }

  // removes cached chats idle for longer than the TTL, then reschedules itself
  async execSweep(taskId: string) {
    logger.debug('[Engine.execSweep]', taskId);

    // check assistant state
    if (this.state !== 'exec') {
      logger.info('[Engine.execSweep]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if task exists
    const task = this.tasks[taskId];
    if (!task) {
      logger.info('[Engine.execSweep]', `task ${taskId} skipped (task not found)`);
      return;
    }

    // remove cached chats idle for longer than the TTL (each agent owns its cache)
    const now = Date.now();
    let removed = 0;
    for (const agent of Object.values(this.agents)) {
      for (const [chatId, chat] of Object.entries(agent.cache)) {
        if (now - (chat.updated || 0) > constants.CHAT_TTL_MS) {
          logger.debug('[Engine.execSweep]', `removing idle chat ${chatId}`);
          delete agent.cache[chatId];
          // also drop the persisted copy, so the chat is fully forgotten
          try { unlinkSync(join(this.work, 'chats', `${chatId}.json`)); } catch { }
          removed++;
        }
      }
    }

    logger.info('[Engine.execSweep]', `removed ${removed} idle chat(s)`);

    const schedule = Math.max(constants.SWEEP_TASK_MS, removed === 0 ? task.schedule * 2 : constants.SWEEP_TASK_MS);

    // re-schedule next execution
    task.timeout = setTimeout(this.execSweep.bind(this), schedule, taskId);
  }

  // prompts the LLM with the task input, sends the result through channels, then reschedules
  async execTask(taskId: string) {
    logger.debug('[Engine.execTask]', taskId);

    // check assistant state
    if (this.state !== 'exec') {
      logger.warn('[Engine.execTask]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if task exists
    const task = this.tasks[taskId];
    if (!task) {
      logger.info('[Engine.execTask]', `task ${taskId} skipped (task not found)`);
      return;
    }

    // check if task is enabled
    if (!task.enabled) {
      logger.info('[Engine.execTask]', `task ${taskId} skipped (task disabled)`);
      return;
    }

    // task must have an input
    if (!task.input) {
      logger.info('[Engine.execTask]', `task ${taskId} skipped (no input)`);
      return;
    }

    // check if agent exists
    const agent = task.agent;
    if (!agent) {
      logger.info('[Engine.execTask]', `task ${taskId} skipped (agent not found)`);
      return;
    }

    // check if agent is enabled
    if (!agent.enabled) {
      logger.info('[Engine.execTask]', `task ${taskId} skipped (agent disabled)`);
      return;
    }

    // TODO: `task-${agentId}-${taskId}` - need a way to decide if chatId should be reused OR new (stateless) chat (current)
    const chatId = undefined; // stateless, design choice, for not

    // ! set task input as user message to LLM
    const result = await agent.sendChat(chatId, task.input);
    if (result.error) {
      logger.error('[Engine.execTask]', `no result from sendChat for task ${taskId}:`, result.error);
      return;
    }

    // send final result through configured channels
    for (const [channelId, groupId] of Object.entries(agent.channels)) {
      try {
        const channel = this.channels[channelId];
        // verify channel exists, warn if not, then skip
        if (!channel) {
          logger.warn('[Engine.execTask]', `channel ${channelId} not found, skipping`);
          continue;
        }

        // ! send message to the channel
        const reply = await channel.sendMessage({ role: 'assistant', content: result.content, group: groupId, agent: agent.id, model: agent.model?.model } as Message);
        if (!reply.ok) {
          logger.warn('[Engine.execTask]', `channel ${channelId} send failed, skipping`);
          continue;
        }

        // try to send, log error if failed, continue
        logger.info('[Engine.execTask]', `message sent to channel ${channelId}:${groupId}`);
      } catch (err) {
        logger.error('[Engine.execTask]', `channel ${channelId} send failed:`, err);
      }
    }

    // ! re-schedule next execution
    task.timeout = setTimeout(this.execTask.bind(this), task.schedule, taskId);
  }
}
