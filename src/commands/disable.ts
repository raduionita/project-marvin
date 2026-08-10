import { execSync } from "node:child_process";
import { Command } from "../types";

// `marvin disable` stops the daemon and disables it from starting at boot
export default class DisableCommand extends Command {
  async exec() {
    console.debug('[DisableCommand.exec]');

    // stop service
    if (this.engine.isDry) {
      console.info('[DisableCommand.exec]', '[dry]', 'stop service: systemctl --user stop marvin');
      console.info('[DisableCommand.exec]', '[dry]', 'disable service: systemctl --user disable marvin');
    } else {
      console.debug('[DisableCommand.exec]', 'stopping service...');
      // stop and disable
      execSync(['systemctl', '--user', 'stop', 'marvin'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'disable', 'marvin'].join(' '), { stdio: 'inherit' });
      // check if service is stopped
      execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { stdio: 'inherit' });
    }

    console.debug('[DisableCommand.exec]', 'marin disabled');
  }
}
