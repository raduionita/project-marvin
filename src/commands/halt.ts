import { execSync } from "node:child_process";
import { Command } from "../types";

export default class HaltCommand extends Command {
  async load() {
    console.debug('[HaltCommand.load]');

    // stop service
    if (this.ctx.isDry) {
      console.log('[HaltCommand.load]', '[dry]', 'stop service: systemctl --user stop marvin');
      console.log('[HaltCommand.load]', '[dry]', 'disable service: systemctl --user disable marvin');
    } else {
      console.log('[HaltCommand.load]', 'stopping service...');
      // stop and disable
      execSync(['systemctl', '--user', 'stop', 'marvin'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'disable', 'marvin'].join(' '), { stdio: 'inherit' });
      // check if service is stopped
      execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { stdio: 'inherit' });
    }
  }
}
