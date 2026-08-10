import { promises } from 'readline';

import { Command } from "../types";

// `marvin agents [command] [--dry]` list, add, bind, chat, drop agents
export default class AgentsCommand extends Command {
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
}
