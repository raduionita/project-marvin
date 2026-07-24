import readline from 'readline';

import { Command } from "../types";

type Result = { ok: boolean; data: { content: string; steps: number; agentId: string, chatId: string } };

export default class ChatCommand extends Command {
  async load() {
    console.debug('[ChatCommand.load]');

    const cmds = process.argv.slice(2);
    const i = cmds.indexOf('--agentId');
    const agentId = (i > -1 ? cmds[i + 1] : '') || this.ctx!.config.settings?.name;
    // build URL to server chat endpoint
    const port = this.ctx!.config?.settings?.port || 7331;
    const host = this.ctx!.config?.settings?.host || '127.0.0.1';
    const url = new URL(`http://${host}:${port}/chat`);
    let   chatId = `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // TODO: start interactive prompt mode here...loop until /exit/quit/stop

    // prompt interactively
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question('Message: ', (ans: string) => {
        resolve(ans);
        rl.close();
      });
    });

    // if empty answer, exit
    if (!answer.trim()) {
      console.warn('[ChatCommand.load]', 'empty message');
      return;
    }

    // send chat message to server /chat
    if (this.ctx.isDry) {
      console.info('[ChatCommand.load]', '[dry]', 'send chat: fetch', url.toString());
      console.info('[ChatCommand.load]', '[dry]', 'message:', answer);
      console.info('[ChatCommand.load]', '[dry]', 'agent:', agentId);
    } else {
      // call chat endpoint
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: answer,
          agentId: agentId,
          chatId: chatId,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        console.error('[ChatCommand.load]', 'chat error:', (json as { error?: string }).error || res.statusText);
        return;
      }
      const result = json as Result;
            chatId = result.data.chatId;
      if (result.ok) {
        console.info('[ChatCommand.load]', `agent=${result.data.agentId} steps=${result.data.steps} chat=${result.data.chatId}`);
        console.info('[ChatCommand.load]', result.data.content);
      }
    }
  }
}
