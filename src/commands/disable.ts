import { execSync } from "node:child_process";
import { Command } from "../types";

export default class DisableCommand extends Command {
  async load() {
    console.debug('[DisableCommand.load]');

    // stop service
    if (this.ctx.isDry) {
      console.log('[DisableCommand.load]', '[dry]', 'stop service: systemctl --user stop marvin');
      console.log('[DisableCommand.load]', '[dry]', 'disable service: systemctl --user disable marvin');
    } else {
      console.log('[DisableCommand.load]', 'stopping service...');
      // stop and disable
      execSync(['systemctl', '--user', 'stop', 'marvin'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'disable', 'marvin'].join(' '), { stdio: 'inherit' });
      // check if service is stopped
      execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { stdio: 'inherit' });
    }
  }
}
