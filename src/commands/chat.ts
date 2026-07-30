import { promises } from 'readline';

import { Command } from "../types";
import ServeCommand from './serve';

type Result = { ok: boolean; data: { content: string; steps: number; agentId: string, chatId: string } };

// marvin chat [agentId] [--dry]
export default class ChatCommand extends ServeCommand {
  async exec() {
    console.debug('[ChatCommand.exec]');

    await this.engine.scanProject();
    await this.engine.loadSystems();
    await this.engine.loadTools();
    await this.engine.loadModels();
    await this.engine.loadAgents();

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
      console.warn('[ChatCommand.exec]', 'empty message');
      return;
    }

    // send chat message to server /chat
    if (this.engine.isDry) {
      console.debug('[ChatCommand.exec]', '[dry]', 'message:', answer);
      console.debug('[ChatCommand.exec]', '[dry]', 'agent:', agentId);
    } else {
      const result = await this.engine.execChat(answer, chatId, agentId);
      if (!result) {
        console.error('[ChatCommand.exec]', 'no result from sendMessage for agent', agentId);
        return;
      }

      // call send chat
      console.log('LLM: ', result.content);
    }
  }
}
