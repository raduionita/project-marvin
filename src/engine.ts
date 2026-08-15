import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";

import type { Logger } from './logger.js';
import { listSystems } from "./systems";
import { Command, Config, Channel, Tool, Model, Agent, System, ToolMeta, Task, Message, Reply, Chat, Integration, Skill, IntegrationAction } from "./types";
import * as constants from './constants.js';
import { listTools, listCustomTools } from "./tools/index.js";
import { listChannels } from "./channels/index.js";
import { listIntegrations } from "./integrations/index.js";
import { listSkills, listCustomSkills, parseSkill } from "./skills/index.js";
import { listModels } from "./models/index.js";
import { join } from "path";
import { extractOutput, cleanContent } from "./helpers.js";
import { readMemorySummary } from "./memory.js";

export default class Engine {
  public state: 'none' | 'load' | 'exec' | 'drop' = 'none';

  public config: Config = constants.DEFAULT_CONFIG as Config;

  private cache: Record<string, Chat> = {}; // chatId: chat

  // TODO: later consider moving browser, http, watch (file watcher) to a separate group "systems"
  public systems: Record<string, System> = {};

  // channels, models, agents
  public channels: Record<string, Channel> = {};
  public integrations: Record<string, Integration> = {};
  public skills: Record<string, Skill> = {};
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
    await this.loadSkills();
    await this.loadModels();
    await this.loadAgents();

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
    await this.dropModels();
    await this.dropChannels();
    await this.dropIntegrations();
    await this.dropSkills();
    await this.dropSystems();

    // release all cached chats
    this.cache = {};

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

    // for each agent, for each task, start setTimeout
    for (const [agentId, agent] of Object.entries(this.agents)) {
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        if (this.isDry) {
          this.logger.info('[Engine.execAgents]', `[dry] task ${taskId} scheduled (${task.schedule}ms) (agent ${agentId})`);
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
        this.logger.debug('[Engine.execAgents]', `task [${taskId}] (${task.type}) scheduled (${task.schedule}ms) (agent ${agentId})`);
      }
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

    const files = listSystems(this).map(f => f.replace('.ts', ''));
    for (const name of files) {
      try {
        if (this.systems[name]) continue;

        const Module = await import(`./systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          this.logger.error('[Engine.loadSystems]', `"${name}" does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this, this.logger);
        await instance.load();
        this.systems[name] = instance;
        this.logger.info('[Engine.loadSystems]', `system "${name}" loaded`);
      } catch (err) {
        this.logger.error('[Engine.loadSystems]', `failed to load "${name}":`, err);
      }
    }
  }

  async loadTools() {
    this.logger.debug('[Engine.loadTools]');

    const files = listTools(this).map(f => f.replace('.ts', ''));
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
  }

  async loadSkills() {
    this.logger.debug('[Engine.loadSkills]');

    // default skills shipped with marvin (src/skills)
    const files = listSkills(this);
    for (const id of files) {
      if (this.skills[id]) continue;
      try {
        const skill = parseSkill(join(import.meta.dirname, 'skills', id), 'default');
        this.skills[id] = skill;
        this.logger.info('[Engine.loadSkills]', `skill "${id}" loaded (default)`);
      } catch (err) {
        this.logger.error('[Engine.loadSkills]', `failed to load "${id}":`, err);
      }
    }

    // custom skills in the workspace (~/.marvin/skills), override defaults
    const cdir = join(this.work, 'skills');
    const cfiles = listCustomSkills(this);
    for (const id of cfiles) {
      try {
        const skill = parseSkill(join(cdir, id), 'custom');
        this.skills[id] = skill;
        this.logger.info('[Engine.loadSkills]', `skill "${id}" loaded (custom)`);
      } catch (err) {
        this.logger.error('[Engine.loadSkills]', `failed to load custom skill "${id}":`, err);
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

      this.logger.info('[Engine.loadAgents]', `task "monitor" created (agent ${marvinId})`);

      // add sweep task (evict idle cached chats) to the orchestrator agent
      this.agents[marvinId].tasks['sweep'] = {
        id: 'sweep',
        enabled: true,
        type: 'sweep',
        schedule: constants.CHAT_SWEEP_MS,
        timeout: null,
        maxSteps: 0,
      } as Task;

      this.logger.info('[Engine.loadAgents]', `task "sweep" created (agent ${marvinId})`);

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
          this.logger.warn('[Engine.loadAgents]', `no input found for task "${taskId}", disabling`);
          enabled = false;
        }

        if (this.isDry) {
          this.logger.info('[Engine.loadAgents]', `[dry] task "${taskId}" created (agent ${agentId})`);
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

        this.logger.info('[Engine.loadAgents]', `task "${taskId}" created (agent ${agentId})`);
      }

      // load agent system prompt (~/.marvin/agents/<agentId>/IDENTITY.md)
      let identity = constants.IDENTITY_MD;
      if (existsSync(join(this.work, 'agents', agentId, 'IDENTITY.md'))) {
        identity = readFileSync(join(this.work, 'agents', agentId, 'IDENTITY.md'), 'utf8').trim();
      } else {
        this.logger.warn('[Engine.loadAgents]', `no IDENTITY.md found for agent "${agentId}", using default`);
      }

      this.agents[agentId] = {
        id: agentId,
        enabled: agent.enabled,
        identity: identity,
        channels: agent.channels,
        model: model,
        tasks: tasks,
      } as Agent;

      this.logger.info('[Engine.loadAgents]',`agent [${agentId}] loaded`);
    }
  }

  async dropAgents() {
    this.logger.debug('[Engine.dropAgents]');
    for (const [agentId, agent] of Object.entries(this.agents)) {
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        if (task.timeout) { 
          this.logger.debug('[Engine.dropAgents]', `stopping task ${taskId}`);
          clearTimeout(task.timeout);
        } else {
          this.logger.debug('[Engine.dropAgents]', `task ${taskId} not running, continuing`);
        }
      }
    }
    this.agents = {};
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

  // for each agent, for each task, start setTimeout

  // monitors the state: checks agents and tasks, then reschedules itself
  async execMonitor(agentId: string, taskId: string) {
    this.logger.debug('[Engine.execMonitor]', agentId, taskId);

    // check assistant state
    if (this.state  !== 'exec') {
      this.logger.info('[Engine.execMonitor]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = this.agents[agentId];
    if (!agent) {
      this.logger.error('[Engine.execMonitor]', `agent ${agentId} NOT found`);
      return;
    }
    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      this.logger.error('[Engine.execMonitor]', `task ${taskId} NOT found`);
      return;
    }
    
    // log agents and their tasks
    this.logger.info('[Engine.execMonitor]', `marvin agents:`);
    for (const [agentId, agent] of Object.entries(this.agents)) {
      this.logger.info('[Engine.execMonitor]', `  agent ${agentId}:`);
      this.logger.info('[Engine.execMonitor]', `    enabled: ${agent.enabled?'yes':'no'}`);
      this.logger.info('[Engine.execMonitor]', `    model: ${agent.model.model}`);
      this.logger.info('[Engine.execMonitor]', `    channels:`);
      for (const [channelId, channel] of Object.entries(agent.channels)) {
        this.logger.info('[Engine.execMonitor]', `      channel: ${channelId} ${channel}`);
      }
      this.logger.info('[Engine.execMonitor]', `    tasks:`);
      for (const [taskId, task] of Object.entries(agent.tasks)) {
        this.logger.info('[Engine.execMonitor]', `      task ${taskId}: ${task.schedule}ms ${task.enabled?'enabled':'disabled'}`);
      }
    }
    
    // re-schedule next execution
    task.timeout = setTimeout(this.execMonitor.bind(this), task.schedule, agentId, taskId);
  }

  // removes cached chats idle for longer than the TTL, then reschedules itself
  async execSweep(agentId: string, taskId: string) {
    this.logger.debug('[Engine.execSweep]', `${agentId}/${taskId}`);

    // check assistant state
    if (this.state !== 'exec') {
      this.logger.info('[Engine.execSweep]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = this.agents[agentId];
    if (!agent) {
      this.logger.info('[Engine.execSweep]', `task ${taskId} skipped (agent not found)`);
      return;
    }
    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      this.logger.info('[Engine.execSweep]', `task ${taskId} skipped (task not found)`);
      return;
    }

    // remove cached chats idle for longer than the TTL
    const now = Date.now();
    let removed = 0;
    for (const [chatId, chat] of Object.entries(this.cache)) {
      if (now - (chat.updated || 0) > constants.CHAT_TTL_MS) {
        this.logger.debug('[Engine.execSweep]', `removing idle chat ${chatId}`);
        delete this.cache[chatId];
        // also drop the persisted copy, so the chat is fully forgotten
        try {
          unlinkSync(join(this.work, 'chats', `${chatId}.json`));
        } catch {
          // no persisted copy, nothing to remove
        }
        removed++;
      }
    }

    this.logger.info('[Engine.execSweep]', `removed ${removed} idle chat(s)`);

    if (this.isDry) {
      this.logger.info('[Engine.execSweep]', '[dry]', 'task executed (once)');
      return;
    }

    const schedule = Math.max(60*60*1000, Math.min(60*1000, removed === 0 ? task.schedule * 2 : task.schedule / 2));

    // re-schedule next execution
    task.timeout = setTimeout(this.execSweep.bind(this), schedule, agentId, taskId);
  }

  // prompts the LLM with the task input, sends the result through channels, then reschedules
  async execInput(agentId: string, taskId: string) {
    this.logger.debug('[Engine.execInput]', `${agentId}/${taskId}`);

    // check assistant state
    if (this.state !== 'exec') {
      this.logger.warn('[Engine.execInput]', `task ${taskId} skipped (assistant NOT running)`);
      return;
    }

    // check if agent exists
    const agent = this.agents[agentId];
    if (!agent) {
      this.logger.info('[Engine.execInput]', `task ${taskId} skipped (agent not found)`);
      return;
    }
    // check if agent is enabled
    if (!agent.enabled) {
      this.logger.info('[Engine.execInput]', `task ${taskId} skipped (agent disabled)`);
      return;
    }

    // check if task exists
    const task = agent.tasks[taskId]!;
    if (!task) {
      this.logger.info('[Engine.execInput]', `task ${taskId} skipped (task not found)`);
      return;
    }
    // check if task is enabled
    if (!task.enabled) {
      this.logger.info('[Engine.execInput]', `task ${taskId} skipped (task disabled)`);
      return;
    }

    if (!task.input) {
      this.logger.info('[Engine.execInput]', `task ${taskId} skipped (no input)`);
      return;
    }

    const maxSteps = task.maxSteps || constants.DEFAULT_MAX_STEPS;

    // TODO: should tasks have cached chats? chatId = `task-${agentId}-${taskId}-${Date.now()}`;
    const chatId = undefined; // stateless, design choice, for not

    const format = task.format || 'json';
    const schema = task.schema || constants.DEFAULT_SCHEMA;

    // set task input as user message to LLM
    const result = await this.sendChat(chatId, agentId, task.input, format, schema, maxSteps);
    if (result.error) {
      this.logger.error('[Engine.execInput]', `no result from sendMessage for agent ${agentId}:`, result.error);
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
          this.logger.warn('[Engine.execInput]', `channel ${channelId} not found, skipping`);
          continue;
        }

        const reply = await channel.sendMessage({ role: 'assistant', content, channel: groupId } as Message);
        if (!reply.ok) {
          this.logger.warn('[Engine.execInput]', `channel ${channelId} send failed, skipping`);
          continue;
        }

        // try to send, log error if failed, continue
        this.logger.info('[Engine.execInput]', `message sent to channel ${channelId}:${groupId}`);
      } catch (err) {
        this.logger.error('[Engine.execInput]', `channel ${channelId} send failed:`, err);
      }
    }

    if (this.isDry) {
      this.logger.info('[Engine.execInput]', '[dry]', 'task executed (once)');
      return;
    }

    // re-schedule next execution
    task.timeout = setTimeout(this.execInput.bind(this), task.schedule, agentId, taskId);
  }

  async execReload() {
    this.logger.debug('[Engine.execReload]');

    // drop in reverse order
    await this.drop();
    // re-load & in dependency order and exec
    await this.exec();
  }

  // tool call
  async  execTool(tool: string, args: {[key:string]:any}) : Promise<{[key:string]:any}> {
    this.logger.debug('[Engine.execTool]', tool);

    const instance = this.tools[tool];
    if (!instance) {
      this.logger.error('[Engine.execTool]', `tool ${tool} not found`);
      return {tool: tool, error: `tool ${tool} does NOT exist`};
    }

    try {
      // ! tool call
      return await instance.call(args);
    } catch (err) {
      this.logger.error('[Engine.execTool]', `tool ${tool} failed:`, err);
      return {tool: tool, error: (err as Error).message};
    }
  }

  // system prompt: identity + the "## Integrations" block from + memory + format
  makeSystemPrompt(agent: Agent, format: 'text' | 'json' = 'json', schema: { [key: string]: string } = constants.DEFAULT_SCHEMA): string {
    // start with the identity
    let system = agent.identity;

    const entries = Object.entries(this.integrations);
    const configs = entries.length ? entries : Object.entries(this.config.integrations || {});

    const blocks = configs.map(([id, integration]) => {
      const isLoaded = integration instanceof Integration;
      const config = isLoaded ? integration.config : integration;
      const meta = isLoaded ? integration.meta :  {
        type: config?.type || 'integration',
        title: id,
        description: '',
        actions: [],
      };
      const endpoint = config?.endpoint || config?.url || config?.baseUrl || '';
      const actions = meta.actions.length
        ? `\nActions: ${meta.actions.map((a: IntegrationAction) => `${a.name} - ${a.description}`).join('; ')}`
        : '';
      const url = endpoint ? ` (${endpoint})` : '';
      return `### ${id}${url}\n${meta.description || meta.title}${actions}`;
    });

    // inject the integrations block
    if (blocks.length) {
      system += '\n\n';
      system += '## Integrations\n';
      system += blocks.join('\n');
    }

    // inject a compact summary of the most recently updated memory notes, so
    // the agent keeps cross-run context (facts, preferences, progress)
    if (this.config.settings.memory || agent.memory) {
      system += '\n\n';
      system += '## Memory\n';
      system += readMemorySummary(this.work) + '\n';
      system += 'Use the memory tool (remember/recall) to read and update these notes.';
    }

    // add the JSON schema for JSON output
    if (format === 'json') {
      system += '\n\n';
      system += `## Output format`;
      system += '- ALWAYS respond in valid JSON format.\n';
      system += '- Use EXACT keys in the JSON schema below.\n';
      system += '- JSON schema: ' + JSON.stringify(schema);
    }

    return system;
  }

  // save chat to cache (and persist it to ~/.marvin/chats/<chatId>.json)
  saveChat(chatId: string | undefined, chat: Chat): void {
    if (!chatId) return;
    chat.updated = Date.now();
    this.cache[chatId] = chat;
    if (this.isDry) return;

    try {
      mkdirSync(join(this.work, 'chats'), { recursive: true });
      writeFileSync(join(this.work, 'chats', `${chatId}.json`), JSON.stringify(chat), 'utf-8');
    } catch (err) {
      this.logger.error('[Engine.saveChat]', 'failed to persist chat:', err);
    }
  }

  // find cached chat by id, falling back to the persisted copy on disk
  findChat(chatId: string | undefined): Chat | null {
    if (!chatId) return null;

    const cached = this.cache[chatId];
    if (cached) {
      cached.updated = Date.now();
      return cached;
    }

    if (this.isDry) return null;

    // load from disk, then re-cache
    try {
      const file = join(this.work, 'chats', `${chatId}.json`);
      if (!existsSync(file)) return null;
      const chat = JSON.parse(readFileSync(file, 'utf-8')) as Chat;
      chat.updated = Date.now();
      this.cache[chatId] = chat;
      return chat;
    } catch (err) {
      this.logger.debug('[Engine.findChat]', 'failed to load chat from disk:', err);
      return null;
    }
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

  // agent loop
  async sendChat(chatId: string | undefined, agentId: string, message: string, format: 'text' | 'json' = 'json', schema: {[key:string]:string} = constants.DEFAULT_SCHEMA, maxSteps: number = constants.DEFAULT_MAX_STEPS) : Promise<{content:string, steps:number, error?: string}> {
    try {
      this.logger.debug('[Engine.sendChat]', chatId, agentId, message.slice(0, 100));

      const agent = this.agents[agentId]!;

      // get chat from cache/store using chatId
      let chat = this.findChat(chatId) || { 
        id: chatId, 
        messages: [{ role: 'system', content: this.makeSystemPrompt(agent, format, schema) }], 
        thinking: false, 
        userId: '', 
        format: format, 
        updated: Date.now() 
      } as Chat;
      
      // load task input as user message
      chat.messages.push({ role: 'user', content: message.trim() });

      // return early
      if (this.isDry) {
        this.logger.info('[Engine.sendChat]', '[dry]', 'send messages to:', agent.model.model);
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
        this.logger.debug('[Engine.sendChat]', `step=${steps}`, `tools={${reply.message.tools?.length}}`);

        // force stop
        if (reply.stop) {
          this.logger.debug('[Engine.sendChat]', `response force stop at step ${steps}`);
          break;
        }

        // execute any tool calls
        for (const tool of reply.message.tools || []) {
          this.logger.debug('[Engine.sendChat]', `executing tool: ${tool.name}`, JSON.stringify(tool.arguments));

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
        //   this.logger.info('[Engine.sendChat]', `response without tool calls, stopping the AI loop`);
        //   break;
        // }

        // if end_chat tool call is found, we're done
        if (ender) {
          this.logger.info('[Engine.sendChat]', `found ${constants.END_CHAT_NAME} tool call, stopping the AI loop`);
          break;
        }
      } while (steps < maxSteps - 1);

      // warn if max steps reached
      if (steps >= maxSteps) {
        this.logger.warn('[Engine.sendChat]', `max steps (${maxSteps}) reached for ${agentId}`);
      }

      // save chat to cache
      this.saveChat(chatId, chat);

      // TODO: more info here
      // when format is json, make sure content is a valid JSON string (the LLM
      // may append markup such as a <tool_calls> block after the JSON)
      const rawContent = reply?.message?.content || '';
      const content = chat.format === 'json' ? cleanContent(rawContent) : rawContent;
      return { content: content, steps: steps };
    } catch (error) {
      this.logger.error('[Engine.sendChat]', error);
      return { content: '', steps: 0, error: (error as Error).message };
    } 
  }
}
