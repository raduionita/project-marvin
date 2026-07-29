import readline from 'readline';

import { Command } from "../types";
import ServeCommand from './serve';

type Result = { ok: boolean; data: { content: string; steps: number; agentId: string, chatId: string } };

// marvin chat agentId [--dry]
export default class ChatCommand extends ServeCommand {
  async exec() {
    console.debug('[ChatCommand.exec]');

    await this.loadSystems();
          this.loadProject();
    await this.loadTools();
    await this.loadModels();
    await this.loadAgents();

    const args = process.argv.slice(2);
    const agentId = args[1] || this.ctx!.config.settings?.name;
    let   chatId = `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // TODO: start interactive prompt mode here...loop until /exit/quit/stop

    // prompt interactively
    const rl = readline.createInterface({input: process.stdin, output: process.stdout, prompt: 'You: '});
    const answer = await new Promise<string>((resolve) => {
      rl.question('Message: ', (ans: string) => {
        resolve(ans);
        rl.close();
      });
    });

    // if empty answer, exit
    if (!answer.trim()) {
      console.warn('[ChatCommand.exec]', 'empty message');
      return;
    }

    // send chat message to server /chat
    if (this.ctx.isDry) {
      console.info('[ChatCommand.exec]', '[dry]', 'message:', answer);
      console.info('[ChatCommand.exec]', '[dry]', 'agent:', agentId);
    } else {

      const result = this.execChat(this.ctx, answer, chatId, agentId);
      // call send chat
    }
  }
}
