import { checkbox, input, select } from '@inquirer/prompts';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import * as constants from '../constants';

// `marvin agents [command] [--dry]` list, add, bind, chat, drop agents
export default class AgentsCommand extends Command {
  async exec() {
    this.logger.debug('[AgentsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        this.logger.warn('[AgentsCommand.exec]', 'unknown command: agents', cmd); 
      case 'help':
        this.logger.info('usage: marvin agents [command] [--dry]');
        this.logger.info('commands:');
        this.logger.info('  help    ', 'show this help');
        this.logger.info('  add     ', 'add an agent');
        this.logger.info('  chat    ', 'send a chat message to the specified agent');
      break;
      case 'add': // `marvin agents add [agentId]` // add an agent interactively


        // TODO: issue here: if marvin.service is already started, systems.api will error (port already in use)
        // TODO: this may not need all the dependencies (like the api, any other?!)
        await this.engine.load();
        
        
        await this.execAdd();


        await this.engine.drop();
      break;
      case 'chat': // `marvin agents chat [agentId]` // send message to agent
        await this.engine.load();
        await this.execChat();
        await this.engine.drop();
      break;
    }
  }

  async execChat() {
    this.logger.debug('[AgentsCommand.execChat]');

    try {
      // default to orchestrator
      const agentId = this.args[0] || this.engine!.config.settings?.name;
      let   chatId = `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // TODO: start interactive prompt mode here...loop until /exit/quit/stop

      // prompt interactively
      const answer = await input({ message: 'You:' });

      // if empty answer, exit
      if (!answer) {
        this.logger.warn('[AgentsCommand.execChat]', 'empty message');
        return;
      }

      // send chat message to server /chat
      if (this.engine.isDry) {
        this.logger.debug('[AgentsCommand.execChat]', '[dry]', 'message:', answer);
        this.logger.debug('[AgentsCommand.execChat]', '[dry]', 'agent:', agentId);
      } else {
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
        this.logger.log('LLM: ', result.content);

        this.logger.debug('[AgentsCommand.execChat]', 'done');
      }
    } catch (error) {
      this.logger.error('[AgentsCommand.execChat]', 'error:', error);
    }
  }

  // `marvin agents add [agentId]` // add an agent interactively
  async execAdd() {
    this.logger.debug('[AgentsCommand.execAdd]', 'adding an agent...');

    try {
      // ask for agentId
      const agentId = this.args[1] || await input({ message: 'Enter agent name (e.g. my-agent):', required: true });
      if (!agentId || !/^[a-zA-Z0-9_-]+$/.test(agentId)) {
        this.logger.error('[AgentsCommand.execAdd]', 'invalid agent name (use a-z, 0-9, _ and -):', agentId);
        return;
      }
  
      // check if agent is already configured
      if (this.engine.config.agents[agentId]) {
        this.logger.warn('[AgentsCommand.execAdd]', `agent "${agentId}" is already configured`);
        return;
      }
  
      // ask for model (known/configured models)
      const modelIds = Object.keys(this.engine.config.models);
      if (modelIds.length === 0) {
        this.logger.error('[AgentsCommand.execAdd]', 'no models configured, please run "marvin models add" first');
        return;
      }

      const defaultModel = modelIds[0]!;
      const modelId = await select({
        message: `Select model (default "${defaultModel}"):`,
        choices: modelIds.map(mid => ({ name: mid, value: mid })),
        default: defaultModel,
      });
      if (!modelIds.includes(modelId)) {
        this.logger.error('[AgentsCommand.execAdd]', `unknown model "${modelId}"`);
        this.logger.error('[AgentsCommand.execAdd]', 'available models:', modelIds.join(', '));
        return;
      }
  
      // ask for channels (known/configured channels)
      const channelIds = Object.keys(this.engine.config.channels);
      const channels: Record<string, string> = {};
      const pickedChannelIds = channelIds.length ? await checkbox({
        message: 'Select channels to bind (space to toggle, enter to confirm):',
        choices: channelIds.map(id => ({ name: id, value: id })),
      }) : [];
      for (const id of pickedChannelIds) {
        if (!channelIds.includes(id)) {
          this.logger.warn('[AgentsCommand.execAdd]', `unknown channel "${id}", skipping`);
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
          });
          if (group === '__manual__') {
            group = await input({ message: `Enter group id for "${id}" (e.g. general), press enter to skip:` });
          }
        } else {
          group = await input({ message: `Enter group id for "${id}" (e.g. general), press enter to skip:` });
        }
        channels[id] = group;
      }
  
      // ask for identity, saved to agents/<agentId>/IDENTITY.md
      const identity = (await input({ message: 'Enter agent identity (or press enter for default):' })) || constants.IDENTITY_MD;
      this.logger.log('');
  
      // persist agent identity to ~/.marvin/agents/<agentId>/IDENTITY.md
      const apath = join(this.engine.work, 'agents', agentId);
      const ipath = join(apath, 'IDENTITY.md');
      if (this.engine.isDry) {
        this.logger.info('[AgentsCommand.execAdd]', '[dry]', 'identity file:', ipath);
      } else {
        mkdirSync(apath, { recursive: true });
        writeFileSync(ipath, identity + '\n');
      }
  
      // register the agent in config
      this.engine.config.agents[agentId] = { enabled: true, model: modelId, channels };
  
      // persist to marvin.json
      const cpath = join(this.engine.work, 'marvin.json');
      if (this.engine.isDry) {
        this.logger.info('[AgentsCommand.execAdd]', '[dry]', `would configure agent "${agentId}", config persisted to ${cpath}`);
      } else {
        writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
      }
  
      this.logger.info(`[AgentsCommand.execAdd]`, `agent "${agentId}" configured (model: ${modelId}, channels: ${Object.keys(channels).join(', ') || 'none'}), config persisted to ${cpath}`);
    } catch (error) {
      this.logger.error('[AgentsCommand.execAdd]', 'error:', error);
    }
  }
}
