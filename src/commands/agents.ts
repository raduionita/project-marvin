import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import * as constants from '../constants';
import { ask } from '../terminal';

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
        await this.execAdd();
      break;
      case 'chat': // `marvin agents chat [agentId]` // send message to agent
        await this.execChat();
      break;
    }
  }

  async execChat() {
    this.logger.debug('[AgentsCommand.execChat]');

    try {
      await this.engine.load();

      // default to orchestrator
      const agentId = this.args[0] || this.engine!.config.settings?.name;
      let   chatId = `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // TODO: start interactive prompt mode here...loop until /exit/quit/stop

      // prompt interactively
      const answer = await ask('You: ');

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
        const result = await this.engine.execChat(chatId, agentId, answer);
        if (result.error) {
          throw new Error(result.error);
        }

        // call send chat
        this.logger.log('LLM: ', result.content);
      }
    } catch (error) {
      this.logger.error('[AgentsCommand.execChat]', 'error:', error);
    } finally {
      await this.engine.drop();
    }

    this.logger.debug('[AgentsCommand.execChat]', 'done');
  }

  // `marvin agents add [agentId]` // add an agent interactively
  async execAdd() {
    this.logger.debug('[AgentsCommand.execAdd]', 'adding an agent...');

    // ask for agentId
    const agentId = this.args[1] || await ask('Enter agent name (e.g. my-agent): ');
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
    this.logger.info('[AgentsCommand.execAdd]', 'configured models:', modelIds.join(', '));
    const defaultModel = modelIds[0]!;
    const modelId = await ask(`Enter model id (press enter for "${defaultModel}"): `) || defaultModel;
    if (!modelIds.includes(modelId)) {
      this.logger.error('[AgentsCommand.execAdd]', `unknown model "${modelId}"`);
      this.logger.error('[AgentsCommand.execAdd]', 'available models:', modelIds.join(', '));
      return;
    }

    // ask for channels (known/configured channels)
    const channelIds = Object.keys(this.engine.config.channels);
    const channels: Record<string, string> = {};
    const raw = channelIds.length
      ? await ask(`Enter channels to bind (comma separated, e.g. ${channelIds.join(',')}), press enter for none: `)
      : '';
    for (const id of raw.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!channelIds.includes(id)) {
        this.logger.warn('[AgentsCommand.execAdd]', `unknown channel "${id}", skipping`);
        continue;
      }
      const group = await ask(`Enter group id for "${id}" (e.g. general), press enter to skip: `);
      channels[id] = group;
    }

    // ask for identity, saved to agents/<agentId>/IDENTITY.md
    const identity = await ask('Enter agent identity (or press enter for default): ') || constants.IDENTITY_MD;
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
    this.engine.config.agents[agentId] = { enabled: true, model: modelId, channels, tasks: {} };

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      this.logger.info('[AgentsCommand.execAdd]', '[dry]', `would configure agent "${agentId}", config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    this.logger.info(`[AgentsCommand.execAdd]`, `agent "${agentId}" configured (model: ${modelId}, channels: ${Object.keys(channels).join(', ') || 'none'}), config persisted to ${cpath}`);
  }
}
