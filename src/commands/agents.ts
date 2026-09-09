import { checkbox, input, select } from '../terminal.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import * as constants from '../constants';
import logger from '../logger.js';

// `marvin agents [command]` list, add, bind, chat, drop agents
export default class AgentsCommand extends Command {
  async exec() {
    logger.debug('[AgentsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        logger.warn('[AgentsCommand.exec]', 'unknown command: agents', cmd); 
      case 'help':
        logger.info('usage: marvin agents [command]');
        logger.info('commands:');
        logger.info('  help    ', 'show this help');
        logger.info('  add     ', 'add an agent');
        logger.info('  edit    ', 'edit an agent');
        logger.info('  chat    ', 'send a chat message to the specified agent');
      break;
      case 'add': // `marvin agents add [agentId]` // add an agent interactively
        await this.execAdd();
      break;
      case 'edit': // `marvin agents edit [agentId]` // edit an agent interactively
        await this.execEdit();
      break;
      case 'chat': // `marvin agents chat [agentId]` // send message to agent

        // TODO: this is NOT ok. needs serve command to be started, it needs all the internarls of serve
        // TODO: update this to send to api/http server at `/chat`

        // TODO: issue here: if marvin.service is already started, systems.api will error (port already in use)
        // TODO: this may not need all the dependencies (like the api, any other?!)
        // await this.engine.load();
        await this.execChat();
        // await this.engine.drop();
      break;
    }
  }

  async execChat() {
    logger.debug('[AgentsCommand.execChat]');

    try {
      // default to orchestrator
      const agentId = this.args[0] || this.engine!.config.settings?.name;
      let   chatId = `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // TODO: start interactive prompt mode here...loop until /exit/quit/stop

      // prompt interactively
      const answer = await input({ message: 'You:' });

      // if empty answer, exit
      if (!answer) {
        logger.warn('[AgentsCommand.execChat]', 'empty message');
        return;
      }

      // TODO: send chat message to server /chat
      
      // send message to the LLM
      const agent = this.engine.agents[agentId];
      if (!agent) {
        throw new Error(`agent "${agentId}" not found`);
      }
      const result = await agent.sendChat(chatId, answer);
      if (result.error) {
        throw new Error(result.error);
      }

      // call send chat
      logger.log('LLM: ', result.content);

      logger.debug('[AgentsCommand.execChat]', 'done');
    } catch (error) {
      logger.error('[AgentsCommand.execChat]', 'error:', error);
    }
  }

  // `marvin agents add [agentId]` // add an agent interactively
  async execAdd() {
    logger.debug('[AgentsCommand.execAdd]', 'adding an agent...');

    try {
      // ask for agentId
      const agentId = this.args[1] || await input({ message: 'Enter agent name (e.g. my-agent):', required: true });
      if (!agentId || !/^[a-zA-Z0-9_-]+$/.test(agentId)) {
        logger.error('[AgentsCommand.execAdd]', 'invalid agent name (use a-z, 0-9, _ and -):', agentId);
        return;
      }
  
      // check if agent is already configured
      if (this.engine.config.agents[agentId]) {
        logger.warn('[AgentsCommand.execAdd]', `agent "${agentId}" is already configured`);
        return;
      }
  
      // ask for model (known/configured models)
      const modelId = await this.pickModel();
      if (!modelId) return;

      // ask for channels (known/configured channels)
      const channels = await this.pickChannels({});
      if (!channels) return;

      // ask for identity, saved to agents/<agentId>/IDENTITY.md
      const identity = (await input({ message: 'Enter agent identity (or press enter for default):' })) || constants.IDENTITY_MD;
      logger.log('');

      // ask for tool groups (control tools are always loaded)
      const tools = await this.pickTools([]);
      if (!tools) {
        logger.error('[AgentsCommand.execAdd]', 'no tool groups selected, agent not created');
        return;
      }

      // persist agent identity to ~/.marvin/agents/<agentId>/IDENTITY.md
      const apath = join(this.engine.work, 'agents', agentId);
      mkdirSync(apath, { recursive: true });
      const ipath = join(apath, 'IDENTITY.md');
      writeFileSync(ipath, identity + '\n');
  
      // register the agent in config
      this.engine.config.agents[agentId] = { enabled: true, model: modelId, channels, tools };

      // persist to marvin.json
      this.saveConfig();

      logger.info(`agent "${agentId}" configured`);
    } catch (error) {
      logger.error('[AgentsCommand.execAdd]', 'error:', error);
    }
  }

  // `marvin agents edit [agentId]` // edit an agent interactively (current values pre-selected)
  async execEdit() {
    logger.debug('[AgentsCommand.execEdit]', 'editing an agent...');

    try {
      // pick the agent (or take it from args)
      const agentIds = Object.keys(this.engine.config.agents || {});
      if (!agentIds.length) {
        logger.warn('[AgentsCommand.execEdit]', 'no agents configured');
        return;
      }
      const agentId = this.args[1] || await select({
        message: 'Select agent to edit:',
        choices: agentIds.map(id => ({ name: id, value: id })),
      });

      // must exist
      const current = this.engine.config.agents[agentId];
      if (!current) {
        logger.error('[AgentsCommand.execEdit]', `agent "${agentId}" not found in config`);
        return;
      }

      // ask for model (current pre-selected)
      const modelId = await this.pickModel(current.model);
      if (!modelId) return;

      // ask for channels (current pre-selected)
      const channels = await this.pickChannels(current.channels || {});
      if (!channels) return;

      // ask for identity (blank keeps the current one)
      const ipath = join(this.engine.work, 'agents', agentId, 'IDENTITY.md');
      let currentIdentity = constants.IDENTITY_MD;
      try {
        if (existsSync(ipath)) currentIdentity = readFileSync(ipath, 'utf8').trim() || currentIdentity;
      } catch { }
      const identity = (await input({ message: 'Enter agent identity (blank keeps current):', default: currentIdentity })) || currentIdentity;
      logger.log('');

      // ask for tool groups (current pre-selected)
      const tools = await this.pickTools(current.tools || []);
      if (!tools) {
        logger.error('[AgentsCommand.execEdit]', 'no tool groups selected, agent not updated');
        return;
      }

      // persist agent identity to ~/.marvin/agents/<agentId>/IDENTITY.md
      const apath = join(this.engine.work, 'agents', agentId);
      mkdirSync(apath, { recursive: true });
      writeFileSync(ipath, identity + '\n');

      // update the agent in config
      this.engine.config.agents[agentId] = { ...current, model: modelId, channels, tools };

      // persist to marvin.json
      this.saveConfig();

      logger.info(`agent "${agentId}" updated`);
    } catch (error) {
      logger.error('[AgentsCommand.execEdit]', 'error:', error);
    }
  }

  // ask for model (known/configured models), pre-selecting current when given.
  // returns the model id, or null when no models are configured / unknown selection
  async pickModel(current?: string): Promise<string | null> {
    const modelIds = Object.keys(this.engine.config.models);
    if (modelIds.length === 0) {
      logger.error('[AgentsCommand.pickModel]', 'no models configured, please run "marvin models add" first');
      return null;
    }

    const def = (current && modelIds.includes(current)) ? current : modelIds[0]!;
    const modelId = await select({
      message: `Select model (default "${def}"):`,
      choices: modelIds.map(mid => ({ name: mid, value: mid })),
      default: def,
    });
    if (!modelIds.includes(modelId)) {
      logger.error('[AgentsCommand.pickModel]', `unknown model "${modelId}"`);
      logger.error('[AgentsCommand.pickModel]', 'available models:', modelIds.join(', '));
      return null;
    }
    return modelId;
  }

  // ask for channels (known/configured channels), pre-selecting prev bindings.
  // returns the channel->group map
  async pickChannels(prev: Record<string, string>): Promise<Record<string, string>> {
    const channelIds = Object.keys(this.engine.config.channels);
    const channels: Record<string, string> = {};
    const pickedChannelIds = channelIds.length ? await checkbox({
      message: 'Select channels to bind (space to toggle, enter to confirm):',
      choices: channelIds.map(id => ({ name: id, value: id, checked: prev[id] !== undefined })),
    }) : [];
    for (const id of pickedChannelIds) {
      if (!channelIds.includes(id)) {
        logger.warn('[AgentsCommand.pickChannels]', `unknown channel "${id}", skipping`);
        continue;
      }
      // prefer the groups cached by "marvin channels info", fall back to free text
      const groups = this.engine.config.channels[id]?.groups || {};
      const groupKeys = Object.keys(groups);
      let group: string;
      if (groupKeys.length) {
        group = await select({
          message: `Select group for "${id}" (from cached channel info):`,
          choices: [
            ...Object.entries(groups).map(([gid, name]) => ({ name: `${name} (${gid})`, value: gid })),
            { name: '(type manually)', value: '__manual__' },
          ],
          default: (prev[id] && prev[id] !== '__manual__') ? prev[id] : undefined,
        });
        if (group === '__manual__') {
          group = (await input({ message: `Enter group id for "${id}" (e.g. general), blank keeps current:`, default: prev[id] })) || prev[id] || '';
        }
      } else {
        group = (await input({ message: `Enter group id for "${id}" (e.g. general), blank keeps current:`, default: prev[id] })) || prev[id] || '';
      }
      channels[id] = group;
    }
    return channels;
  }

  // load all tools and ask for tool groups, pre-selecting prev.
  // returns the picked groups, or null when nothing was picked (abort)
  async pickTools(prev: string[]): Promise<string[] | null> {
    await this.engine.loadMcps();
    await this.engine.loadTools();
    const groups = [...new Set(Object.values(this.engine.tools).map(t => t.meta.group))]
      .filter(g => g !== 'control')
      .sort();
    if (!groups.length) return [];
    const tools = await checkbox({
      message: 'Select tool groups to load (control tools are always loaded):',
      choices: groups.map(g => ({ name: g, value: g, checked: prev.includes(g) })),
    });
    if (!tools.length) return null;
    return tools;
  }

  saveConfig() {
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    logger.info(`config updated: ${cpath}`);
  }
}
