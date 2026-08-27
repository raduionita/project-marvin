import { existsSync, readFileSync, unlinkSync } from "fs";

import type { Logger } from './logger.js';
import { listSystems, loadSystem } from "./systems";
import { Command, Config, Channel, Tool, Model, System, Task, Message, Integration, Skill, ToolMeta } from "./types";
import { Agent } from './agent.js';
import * as constants from './constants.js';
import { listInternalTools, listCustomTools } from "./tools/index.js";
import { listChannels } from "./channels/index.js";
import { listIntegrations, loadIntegrationTools } from "./integrations/index.js";
import { Mcp, loadMcpTools } from "./mcp.js";
import { listSkills, loadSkill } from "./skills/index.js";
import { listModels } from "./models/index.js";
import { join } from "path";

export default class Engine {
  public state: 'none' | 'load' | 'exec' | 'drop' = 'none';

  public config: Config = constants.DEFAULT_CONFIG as Config;

  // TODO: later consider moving browser, http, watch (file watcher) to a separate group "systems"
  public systems: Record<string, System> = {};

  // channels, models, agents
  public channels: Record<string, Channel> = {};
  public skills  : Record<string, Skill> = {};
  public models  : Record<string, Model> = {};
  public agents  : Record<string, Agent> = {};
  public tasks   : Record<string, Task> = {};
  
  public tools       : Record<string, Tool> = {};
  public mcps        : Record<string, Mcp> = {};
  public integrations: Record<string, Integration> = {};

  // workspace (~/.marvin) data folder
  public work: string = process.env.HOME + '/.marvin';
  // root (~/) app folder
  public root: string = import.meta.dirname.replace(/\/src.*/, '');

  public isDry: boolean = process.argv.includes('--dry') || process.argv.includes('-dry');
  public isTest: boolean = process.env.NODE_ENV === 'test' || process.env.BUN_TEST === '1';
  public isDebug: boolean =  process.env.MARVIN_LOG_LEVEL === 'debug';

  constructor(public logger: Logger) {
    this.logger.debug('[Engine.constructor]');
  }

  async load() {
    this.logger.debug('[Engine.load]');

    if (this.state === 'load' || this.state === 'exec') {
      this.logger.error('[Engine.load]', 'engine, already loaded');
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
    this.logger.debug('[Engine.drop]');

    if (this.state !== 'load' && this.state !== 'exec') {
      this.logger.error('[Engine.drop]', 'engine is not in the "exec" state, cannot stop');
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
    this.logger.debug('[Engine.exec]');

    // force load if not loaded
    if (this.state === 'none') {
      await this.load();
    }

    // continue only if loaded
    if (this.state !== 'load') {
      this.logger.error('[Engine.exec]', 'engine is not in the "load" state, cannot exec');
      return;
    }

    // for each task, start setTimeout
    for (const [taskId, task] of Object.entries(this.tasks)) {
      if (this.isDry) {
        this.logger.info('[Engine.execAgents]', `[dry] task ${taskId} scheduled (${task.schedule}ms) (agent ${task.agent?.id})`);
        continue;
      }

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
      this.logger.debug('[Engine.execAgents]', `task [${taskId}] (${task.type}) scheduled (${task.schedule}ms) (agent ${task.agent?.id})`);
    }

    this.state = 'exec';
  }

  async scanProject() {
    this.logger.debug('[Engine.scanProject]');

    // create project/workspace folder (~/.marvin)
    const hpath = this.work;
    if (this.isDry) {
      this.logger.info('[Engine.scanProject]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      this.logger.error('[Engine.scanProject]', `missing ${hpath} folder`, 'please run "marvin install" again');
      return;
    }

    // agents folder (~/.marvin/agents)
    const apath = join(hpath, 'agents');
    if (this.isDry) {
      this.logger.info('[Engine.scanProject]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      this.logger.error('[Engine.scanProject]', `missing ${apath} folder`, 'please run "marvin install" again');
      return;
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(hpath, 'MARVIN.md');
    if (this.isDry) {
      this.logger.info('[Engine.scanProject]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      this.logger.error('[Engine.scanProject]', `missing ${mpath} file`, 'please run "marvin install" again');
      return;
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.isDry) {
      this.logger.info('[Engine.scanProject]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      this.logger.error('[Engine.scanProject]', `missing ${cpath} file`, 'please run "marvin install" again');
      return;
    }
  }

  async loadSystems() {
    this.logger.debug('[Engine.loadSystems]');

    const files = listSystems(this);
    for (const name of files) {
      try {
        if (this.systems[name]) continue;
        // register instance of System
        const instance = await loadSystem(this, name);
        await instance.load();
        this.systems[name] = instance;
        this.logger.info('[Engine.loadSystems]', `system "${name}" loaded`);
      } catch (err) {
        this.logger.error('[Engine.loadSystems]', `failed to load "${name}":`, err);
      }
    }

    this.logger.debug('[Engine.loadSystems]', Object.keys(this.systems));
  }

  async loadTools() {
    this.logger.debug('[Engine.loadTools]');

    const files = listInternalTools(this);
    for (const file of files) {
      const name = file;
      try {
        if (this.tools[name]) continue;

        const Module = await import(`./tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          this.logger.error('[Engine.loadTools]', `"${file}" does not export a Tool class, skipping`);
          continue;
        }

        // register instance of Tool
        const instance = new Class(this, this.logger);
        const meta = instance.meta as ToolMeta;
        this.tools[meta.function.name] = instance;
        this.logger.info('[Engine.loadTools]', `tool "${meta.function.name}" loaded`);
      } catch (err) {
        this.logger.error('[Engine.loadTools]', `failed to load "${file}":`, err);
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
          this.logger.error('[Engine.loadTools]', `"${file}" does not export a Tool class, skipping`);
          continue;
        }

        // register instance of Tool
        const instance = new Class(this, this.logger);
        const meta = instance.meta as ToolMeta;
        this.tools[meta.function.name] = instance;
        this.logger.info('[Engine.loadTools]', `tool "${meta.function.name}" loaded (custom)`);
      } catch (err) {
        this.logger.error('[Engine.loadTools]', `failed to load custom tool "${file}":`, err);
      }
    }

    this.logger.debug('[Engine.loadTools]', '[', Object.keys(this.tools).join(','), ']');
  }

  async loadChannels() {
    this.logger.debug('[Engine.loadChannels]');
    
    const files = listChannels(this);
    for (const [id, config] of Object.entries(this.config.channels)) {
      if (!config.enabled) continue;

      const file = files.find(f => f === id);
      if (!file) {
        this.logger.error('[Engine.loadChannels]', `no file for channel "${id}", skipping`);
        continue;
      }

      try {
        if (this.channels[id]) continue;

        const Module = await import(`./channels/${file}.js`);
        const Class = Module.default;
        // must be a Channel class
        if (!Class || !(Class.prototype instanceof Channel)) {
          this.logger.error('[Engine.loadChannels]', `"${file}" does not export a Channel class, skipping ${id}`);
          continue;
        }
        // register instance of Channel 
        const instance = new Class(this, this.logger);
        await instance.load();
        this.channels[id] = instance;
        this.logger.info('[Engine.loadChannels]', `channel "${id}" loaded`);
      } catch (err) {
        this.logger.error('[Engine.loadChannels]', `failed to load "${id}":`, err);
      }
    }

    this.logger.debug('[Engine.loadChannels]', Object.keys(this.channels));
  }

  async loadIntegrations() {
    this.logger.debug('[Engine.loadIntegrations]');

    const files = listIntegrations(this);
    for (const [id, config] of Object.entries(this.config.integrations)) {
      if (!config.enabled) continue;

      const file = files.find(f => f === config.type);
      if (!file) {
        this.logger.error('[Engine.loadIntegrations]', `no file for integration "${id}" type "${config.type}", skipping`);
        continue;
      }

      try {
        if (this.integrations[id]) continue;

        const Module = await import(`./integrations/${file}.js`);
        const Class = Module.default;
        // must be an Integration class
        if (!Class || !(Class.prototype instanceof Integration)) {
          this.logger.error('[Engine.loadIntegrations]', `"${id}" does not export an Integration class, skipping`);
          continue;
        }
        // register instance of Integration
        const instance = new Class(this, this.logger, config);
        await instance.load();
        this.integrations[id] = instance;
        this.logger.info('[Engine.loadIntegrations]', `integration "${id}" loaded`);
      } catch (err) {
        this.logger.error('[Engine.loadIntegrations]', `failed to load "${id}":`, err);
      }
    }

    // tools may derive meta from loaded integrations (e.g. call_integration
    // lists the actual sites and actions), so refresh them after loading
    for (const tool of Object.values(this.tools)) {
      const refresh = (tool as { refresh?: () => void }).refresh;
      if (typeof refresh === 'function') refresh.call(tool);
    }

    this.logger.debug('[Engine.loadIntegrations]', Object.keys(this.integrations));
  }

  // connects the configured mcp servers (spawn + initialize)
  async loadMcps() {
    this.logger.debug('[Engine.loadMcps]');

    for (const [id, config] of Object.entries(this.config.mcps || {})) {
      if (!config.enabled) continue;

      try {
        if (this.mcps[id]) continue;
        const mcp = new Mcp(this, this.logger, id, config);
        await mcp.load();
        this.mcps[id] = mcp;
      } catch (err) {
        this.logger.error('[Engine.loadMcps]', `failed to connect mcp "${id}":`, err);
      }
    }

    this.logger.debug('[Engine.loadMcps]', 'mcps:', Object.keys(this.mcps));
  }

  async loadSkills() {
    this.logger.debug('[Engine.loadSkills]');

    // default skills shipped with marvin (src/skills), overridden by
    // custom workspace skills (~/.marvin/skills)
    const ids = [...new Set(listSkills(this).map(f => f.replace(/\.md$/i, '').toLowerCase()))];
    for (const id of ids) {
      try {
        const skill = loadSkill(this, id);
        this.skills[skill.id] = skill;
        this.logger.info('[Engine.loadSkills]', `skill "${skill.id}" loaded (${skill.source})`);
      } catch (err) {
        this.logger.error('[Engine.loadSkills]', `failed to load "${id}":`, err);
      }
    }
  }

  async loadModels() {
    this.logger.debug('[Engine.loadModels]');

    // config models
    const files = listModels(this);
    for (const [modelId, config] of Object.entries(this.config.models)) {
      try {
        if (this.models[modelId]) continue;

        if (!config.enabled) {
          this.logger.warn('[Engine.loadModels]', `model "${modelId}" is disabled, skipping`);
          continue;
        }

        const file = files.find(f => f === config.provider);
        if (!file) {
          this.logger.error('[Engine.loadModels]', `no file for provider ${config.provider}, skipping "${modelId}"`);
          continue;
        }

        // import the model provider
        const Module = await import(`./models/${config.provider}.js`);
        const Class = Module.default;

        // must be a Model class
        if (!Class || !(Class.prototype instanceof Model)) {
          this.logger.error('[Engine.loadModels]', `"${modelId}" does not export a Model class, skipping`);
          continue;
        }
        
        // save instance (needed by agents)
        const instance = new Class(this, this.logger, config);
        this.models[modelId] = instance;

        this.logger.info('[Engine.loadModels]', `model "${modelId}" loaded (${config.provider} ${config.model})`);
      } catch (err) {
        this.logger.error('[Engine.loadModels]', `failed to load "${modelId}":`, err);
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
          this.logger.error('[Engine.loadModels]', `"${modelId}" does not export a Model class!`);
          process.exit(1);
        }

        const instance = new Class(this, this.logger, {provider: 'fallback', model: 'fallback'});
        this.models[modelId] = instance;

        // warn because fallback model is not a good idea, and does NOTHING
        this.logger.info('[Engine.loadModels]', `model "${modelId}" fallback`);
      } catch (err) {
        this.logger.error('[Engine.loadModels]', `failed to load "${modelId}":`, err);
      }
    }
  }

  async loadAgents() {
    this.logger.debug('[Engine.loadAgents]');

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
        this.logger.warn('[Engine.loadAgents]', `no MARVIN.md found for agent "${marvinId}", using default`);
      }

      // add ochestrator agent
      this.agents[marvinId] = new Agent(this, this.logger, {
        id: marvinId,
        enabled: true,
        memory: this.config.settings.memory,
        identity: identity,
        channels: {},
        model: model,
      });

      this.logger.info('[Engine.loadAgents]',`agent "${marvinId}" loaded`);
    }

    // type: agent
    for (const [agentId, agent] of Object.entries(this.config.agents)) {
      if (this.agents[agentId]) continue;

      const model = this.models[agent.model || ''];
      if (!model) {
        this.logger.error('[Engine.loadAgents]', `model not found for agent "${agentId}": ${agent.model}`);
        continue;
      }

      // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
      let identity = constants.IDENTITY_MD;
      if (existsSync(join(this.work, 'agents', agentId, 'IDENTITY.md'))) {
        identity = readFileSync(join(this.work, 'agents', agentId, 'IDENTITY.md'), 'utf8').trim();
      } else {
        this.logger.warn('[Engine.loadAgents]', `no IDENTITY.md found for agent "${agentId}", using default`);
      }

      this.agents[agentId] = new Agent(this, this.logger, {
        id: agentId,
        enabled: agent.enabled,
        memory: this.config.settings.memory,
        identity: identity,
        channels: agent.channels,
        model: model,
      });

      this.logger.info('[Engine.loadAgents]',`agent [${agentId}] loaded`);
    }

    this.logger.debug('[Engine.loadAgents]', 'agents:', Object.keys(this.agents));
  }

  // loads tasks: the internal monitor/sweep tasks run on the orchestrator
  // agent, config tasks run on the agent referenced by task.agent
  async loadTasks() {
    this.logger.debug('[Engine.loadTasks]');

    const marvinId = this.config.settings.name;
    const marvin = this.agents[marvinId];

    // internal tasks: monitor (state/health check) + sweep (evict idle chats)
    if (marvin) {
      this.tasks['monitor'] = {
        id: 'monitor',
        enabled: true,
        type: 'monitor',
        agent: marvin,
        schedule: 60*60*1000,
        timeout: null,
        maxSteps: 0,
        input: 'monitor',
      } as Task;

      this.tasks['sweep'] = {
        id: 'sweep',
        enabled: true,
        type: 'sweep',
        agent: marvin,
        schedule: constants.CHAT_SWEEP_MS,
        timeout: null,
        maxSteps: 0,
        input: 'sweep',
      } as Task;

      this.logger.info('[Engine.loadTasks]', `tasks "monitor" and "sweep" created (agent ${marvinId})`);
    }

    // config tasks
    for (const [taskId, task] of Object.entries(this.config.tasks || {})) {
      const agent = this.agents[task.agent || marvinId];
      if (!agent) {
        this.logger.error('[Engine.loadTasks]', `agent not found for task "${taskId}": ${task.agent || marvinId}, skipping`);
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
        this.logger.warn('[Engine.loadTasks]', `no input found for task "${taskId}", disabling`);
        enabled = false;
      }

      if (this.isDry) {
        this.logger.info('[Engine.loadTasks]', `[dry] task "${taskId}" created (agent ${agent.id})`);
        continue;
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
        integrations: task.integrations,
      } as Task;

      this.logger.info('[Engine.loadTasks]', `task "${taskId}" created (agent ${agent.id})`);
    }

    this.logger.debug('[Engine.loadTasks]', 'tasks:', Object.keys(this.tasks));
  }

  async dropAgents() {
    this.logger.debug('[Engine.dropAgents]');
    this.agents = {};
  }

  async dropTasks() {
    this.logger.debug('[Engine.dropTasks]');
    for (const [taskId, task] of Object.entries(this.tasks)) {
      if (task.timeout) {
        this.logger.debug('[Engine.dropTasks]', `stopping task ${taskId}`);
        clearTimeout(task.timeout);
      } else {
        this.logger.debug('[Engine.dropTasks]', `task ${taskId} not running, continuing`);
      }
    }
    this.tasks = {};
  }

  async dropModels() {
    this.logger.debug('[Engine.dropModels]');
    this.models = {};
  }

  async dropSkills() {
    this.logger.debug('[Engine.dropSkills]');
    this.skills = {};
  }

  async dropIntegrations() {
    this.logger.debug('[Engine.dropIntegrations]');
    this.integrations = {};
  }

  // will detach and delete ALL channels from the engine
  async dropChannels() {
    this.logger.debug('[Engine.dropChannels]');
    for (const [channelId, channel] of Object.entries(this.channels)) {
      try {
        this.logger.debug('[Engine.dropChannels]', `detaching channel ${channelId}`);
        await channel.drop();
      } catch (err) {
        this.logger.error('[Engine.dropChannels]', `error detaching channel:`, err);
      }
    }
    this.channels = {};
  }

  // will detach and delete the channel from the engine
  async dropChannel(id: string) {
    this.logger.debug('[Engine.dropChannel]', id);
    if (this.channels[id]) {
      try {
        this.channels[id].drop();
      } catch (err) {
        this.logger.error('[Engine.dropChannel]', `error detaching channel:`, err);
      }
      delete this.channels[id];
    }
  }

  async dropIntegration(id: string) {
    this.logger.debug('[Engine.dropIntegration]', id);
    delete this.integrations[id];
  }

  // disconnects all mcp servers (kills their processes)
  async dropMcps() {
    this.logger.debug('[Engine.dropMcps]');
    for (const [id, client] of Object.entries(this.mcps)) {
      try {
        this.logger.debug('[Engine.dropMcps]', `disconnecting mcp ${id}`);
        await client.drop();
      } catch (err) {
        this.logger.error('[Engine.dropMcps]', `error disconnecting mcp ${id}:`, err);
      }
    }
    this.mcps = {};
  }

  // disconnect and remove a single mcp server from the engine
  async dropMcp(id: string) {
    this.logger.debug('[Engine.dropMcp]', id);
    const client = this.mcps[id];
    if (client) {
      try {
        await client.drop();
      } catch (err) {
        this.logger.error('[Engine.dropMcp]', `error disconnecting mcp ${id}:`, err);
      }
      delete this.mcps[id];
    }
  }

  async dropSystems() {
    this.logger.debug('[Engine.dropSystems]');
    for (const [name, system] of Object.entries(this.systems)) {
      try {
        this.logger.debug('[Engine.dropSystems]', `detaching system ${name}`);
        await system.drop();
      } catch (err) {
        this.logger.error('[Engine.dropSystems]', `error detaching system:`, err);
      }
    }
    this.systems = {};
  }

  // drop and re-exec the engine
  async execReload() {
    this.logger.debug('[Engine.execReload]');

    // drop in reverse order
    await this.drop();
    // re-load & in dependency order and exec
    await this.exec();
  }

  // for each agent, for each task, start setTimeout

  // monitors the state: checks agents and tasks, then reschedules itself
  async execMonitor(taskId: string) {
    this.logger.debug('[Engine.execMonitor]', taskId);

    // check assistant state
    if (this.state !== 'exec') {
      this.logger.info('[Engine.execMonitor]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if task exists
    const task = this.tasks[taskId];
    if (!task) {
      this.logger.error('[Engine.execMonitor]', `task ${taskId} NOT found`);
      return;
    }
    
    // log agents and their tasks
    this.logger.info('[Engine.execMonitor]', `marvin agents:`);
    for (const [agentId, agent] of Object.entries(this.agents)) {
      this.logger.info('[Engine.execMonitor]', `agent ${agentId}:`);
      this.logger.info('[Engine.execMonitor]', `- enabled: ${agent.enabled?'yes':'no'}`);
      this.logger.info('[Engine.execMonitor]', `- model: ${agent.model.model}`);
      this.logger.info('[Engine.execMonitor]', `- channels: ${Object.keys(agent.channels)}`);
    }

    this.logger.info('[Engine.execMonitor]', `  tasks:`);
    for (const [taskId, task] of Object.entries(this.tasks)) {
      this.logger.info('[Engine.execMonitor]', `task ${taskId}`);
      this.logger.info('[Engine.execMonitor]', `- input: ${task.input?.slice(0, 32)}`);
      this.logger.info('[Engine.execMonitor]', `- schedule: ${task.schedule}ms`);
    }
    
    // re-schedule next execution
    task.timeout = setTimeout(this.execMonitor.bind(this), task.schedule, taskId);
  }

  // removes cached chats idle for longer than the TTL, then reschedules itself
  async execSweep(taskId: string) {
    this.logger.debug('[Engine.execSweep]', taskId);

    // check assistant state
    if (this.state !== 'exec') {
      this.logger.info('[Engine.execSweep]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if task exists
    const task = this.tasks[taskId];
    if (!task) {
      this.logger.info('[Engine.execSweep]', `task ${taskId} skipped (task not found)`);
      return;
    }

    // remove cached chats idle for longer than the TTL (each agent owns its cache)
    const now = Date.now();
    let removed = 0;
    for (const agent of Object.values(this.agents)) {
      for (const [chatId, chat] of Object.entries(agent.cache)) {
        if (now - (chat.updated || 0) > constants.CHAT_TTL_MS) {
          this.logger.debug('[Engine.execSweep]', `removing idle chat ${chatId}`);
          delete agent.cache[chatId];
          // also drop the persisted copy, so the chat is fully forgotten
          try {
            unlinkSync(join(this.work, 'chats', `${chatId}.json`));
          } catch {
            // no persisted copy, nothing to remove
          }
          removed++;
        }
      }
    }

    this.logger.info('[Engine.execSweep]', `removed ${removed} idle chat(s)`);

    if (this.isDry) {
      this.logger.info('[Engine.execSweep]', '[dry]', 'task executed (once)');
      return;
    }

    const schedule = Math.max(60*60*1000, Math.min(60*1000, removed === 0 ? task.schedule * 2 : task.schedule / 2));

    // re-schedule next execution
    task.timeout = setTimeout(this.execSweep.bind(this), schedule, taskId);
  }

  // prompts the LLM with the task input, sends the result through channels, then reschedules
  async execTask(taskId: string) {
    this.logger.debug('[Engine.execTask]', taskId);

    // check assistant state
    if (this.state !== 'exec') {
      this.logger.warn('[Engine.execTask]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if task exists
    const task = this.tasks[taskId];
    if (!task) {
      this.logger.info('[Engine.execTask]', `task ${taskId} skipped (task not found)`);
      return;
    }

    // check if task is enabled
    if (!task.enabled) {
      this.logger.info('[Engine.execTask]', `task ${taskId} skipped (task disabled)`);
      return;
    }

    // task must have an input
    if (!task.input) {
      this.logger.info('[Engine.execTask]', `task ${taskId} skipped (no input)`);
      return;
    }

    // check if agent exists
    const agent = task.agent;
    if (!agent) {
      this.logger.info('[Engine.execTask]', `task ${taskId} skipped (agent not found)`);
      return;
    }

    // check if agent is enabled
    if (!agent.enabled) {
      this.logger.info('[Engine.execTask]', `task ${taskId} skipped (agent disabled)`);
      return;
    }

    // TODO: `task-${agentId}-${taskId}` - need a way to decide if chatId should be reused OR new (stateless) chat (current)
    const chatId = undefined; // stateless, design choice, for not

    // merge engine (default) tools with the task's integration + mcp tools
    const tools = [
      ...await loadIntegrationTools(this, task.integrations || []),
      ...await loadMcpTools(this, task.mcps || []),
    ];

    // ! set task input as user message to LLM
    const result = await agent.sendChat(chatId, task.input, tools);
    if (result.error) {
      this.logger.error('[Engine.execTask]', `no result from sendChat for task ${taskId}:`, result.error);
      return;
    }

    // send final result through configured channels
    for (const [channelId, groupId] of Object.entries(agent.channels)) {
      try {
        const channel = this.channels[channelId];
        // verify channel exists, warn if not, then skip
        if (!channel) {
          this.logger.warn('[Engine.execTask]', `channel ${channelId} not found, skipping`);
          continue;
        }

        // ! send message to the channel
        const reply = await channel.sendMessage({ role: 'assistant', content: result.content, group: groupId, agent: agent.id, model: agent.model?.model } as Message);
        if (!reply.ok) {
          this.logger.warn('[Engine.execTask]', `channel ${channelId} send failed, skipping`);
          continue;
        }

        // try to send, log error if failed, continue
        this.logger.info('[Engine.execTask]', `message sent to channel ${channelId}:${groupId}`);
      } catch (err) {
        this.logger.error('[Engine.execTask]', `channel ${channelId} send failed:`, err);
      }
    }

    // don't schedule anything
    if (this.isDry) {
      this.logger.info('[Engine.execTask]', '[dry]', 'task executed (once)');
      return;
    }

    // ! re-schedule next execution
    task.timeout = setTimeout(this.execTask.bind(this), task.schedule, taskId);
  }
}
