import { promises } from 'readline';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import * as constants from '../constants';

// `marvin agents [command] [--dry]` list, add, bind, chat, drop agents
export default class AgentsCommand extends Command {
  // overridable for tests (scripted answers)
  public ask?: (question: string) => Promise<string>;

  async exec() {
    console.debug('[AgentsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        console.warn('[AgentsCommand.exec]', 'unknown command: agents', cmd); 
      case 'help':
        console.info('usage: marvin agents [command] [--dry]');
        console.info('commands:');
        console.info('  help    ', 'show this help');
        console.info('  add     ', 'add an agent');
        console.info('  chat    ', 'send a chat message to the specified agent');
      break;
      // `marvin agents add [agentId]` // add an agent interactively
      case 'add':
        await this.execAdd();
      break;
      // `marvin agents chat [agentId]` // send message to agent
      case 'chat':
        await this.engine.load();
        await this.execChat();
        await this.engine.drop();
      break;
    }
  }

  async execChat() {
    console.debug('[AgentsCommand.execChat]');

    // default to orchestrator
    const agentId = this.args[0] || this.engine!.config.settings?.name;
    let   chatId = `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // TODO: start interactive prompt mode here...loop until /exit/quit/stop

    // prompt interactively
    const pli = promises.createInterface({input: process.stdin, output: process.stdout, });
    const answer = (await pli.question('You: ')).trim();
    pli.close();

    // if empty answer, exit
    if (!answer) {
      console.warn('[AgentsCommand.execChat]', 'empty message');
      return;
    }

    // send chat message to server /chat
    if (this.engine.isDry) {
      console.debug('[AgentsCommand.execChat]', '[dry]', 'message:', answer);
      console.debug('[AgentsCommand.execChat]', '[dry]', 'agent:', agentId);
    } else {
      const result = await this.engine.execChat(chatId, agentId, answer);
      if (!result) {
        console.error('[AgentsCommand.execChat]', 'no result from sendMessage for agent', agentId);
        return;
      }

      // call send chat
      console.log('LLM: ', result.content);
    }

    console.debug('[AgentsCommand.execChat]', 'done');
  }

  // `marvin agents add [agentId]` // add an agent interactively
  async execAdd() {
    console.debug('[AgentsCommand.execAdd]', 'adding an agent...');

    const ask = this.ask || (async (q: string) => {
      const pli = promises.createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await pli.question(q)).trim();
      pli.close();
      return answer;
    });

    console.log('');

    // ask for agentId
    const agentId = this.args[1] || await ask('Enter agent name (e.g. my-agent): ');
    if (!agentId || !/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      console.error('[AgentsCommand.execAdd]', 'invalid agent name (use a-z, 0-9, _ and -):', agentId);
      return;
    }

    // check if agent is already configured
    if (this.engine.config.agents[agentId]) {
      console.warn('[AgentsCommand.execAdd]', `agent "${agentId}" is already configured`);
      return;
    }

    // ask for model (known/configured models)
    const modelIds = Object.keys(this.engine.config.models);
    if (modelIds.length === 0) {
      console.error('[AgentsCommand.execAdd]', 'no models configured, please run "marvin models add" first');
      return;
    }
    console.info('[AgentsCommand.execAdd]', 'configured models:', modelIds.join(', '));
    const defaultModel = modelIds[0]!;
    const modelId = await ask(`Enter model id (press enter for "${defaultModel}"): `) || defaultModel;
    if (!modelIds.includes(modelId)) {
      console.error('[AgentsCommand.execAdd]', `unknown model "${modelId}"`);
      console.error('[AgentsCommand.execAdd]', 'available models:', modelIds.join(', '));
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
        console.warn('[AgentsCommand.execAdd]', `unknown channel "${id}", skipping`);
        continue;
      }
      const group = await ask(`Enter group id for "${id}" (e.g. general), press enter to skip: `);
      channels[id] = group;
    }

    // ask for identity, saved to agents/<agentId>/IDENTITY.md
    const identity = await ask('Enter agent identity (or press enter for default): ') || constants.IDENTITY_MD;
    console.log('');

    // persist agent identity to ~/.marvin/agents/<agentId>/IDENTITY.md
    const apath = join(this.engine.work, 'agents', agentId);
    const ipath = join(apath, 'IDENTITY.md');
    if (this.engine.isDry) {
      console.info('[AgentsCommand.execAdd]', '[dry]', 'identity file:', ipath);
    } else {
      mkdirSync(apath, { recursive: true });
      writeFileSync(ipath, identity + '\n');
    }

    // register the agent in config
    this.engine.config.agents[agentId] = { enabled: true, model: modelId, channels, tasks: {} };

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      console.info('[AgentsCommand.execAdd]', '[dry]', `would configure agent "${agentId}", config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    console.info(`[AgentsCommand.execAdd]`, `agent "${agentId}" configured (model: ${modelId}, channels: ${Object.keys(channels).join(', ') || 'none'}), config persisted to ${cpath}`);
  }
}