import { promises } from 'readline';

import { Command } from "../types";

// marvin chat [agentId] [--dry]
export default class ChatCommand extends Command {
  async exec() {
    console.debug('[ChatCommand.exec]');

    await this.engine.load();

    await this.execChat();
  }

  async drop() {
    console.debug('[ChatCommand.drop]');
    await this.engine.drop();
  }

  async execChat() {
    console.debug('[ChatCommand.execChat]');

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
      console.warn('[ChatCommand.execChat]', 'empty message');
      return;
    }

    // send chat message to server /chat
    if (this.engine.isDry) {
      console.debug('[ChatCommand.execChat]', '[dry]', 'message:', answer);
      console.debug('[ChatCommand.execChat]', '[dry]', 'agent:', agentId);
    } else {
      const result = await this.engine.execChat(chatId, agentId, answer);
      if (!result) {
        console.error('[ChatCommand.execChat]', 'no result from sendMessage for agent', agentId);
        return;
      }

      // call send chat
      console.log('LLM: ', result.content);
    }

    console.debug('[ChatCommand.execChat]', 'done');
  }
}
