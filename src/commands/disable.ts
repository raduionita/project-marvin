import { execSync } from "node:child_process";
import { Command } from "../types";

// `marvin disable` stops the daemon and disables it from starting at boot
export default class DisableCommand extends Command {
  async exec() {
    console.debug('[DisableCommand.exec]');

    try {

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
        const state = execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
        console.debug('[DisableCommand.exec]', 'marvin is', state);
      }
    } catch (err) {
      console.warn('[DisableCommand.exec]', 'error:', err);
    }

    console.debug('[DisableCommand.exec]', 'marin disabled');
  }
}
