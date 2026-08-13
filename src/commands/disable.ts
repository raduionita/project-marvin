import { execSync } from "node:child_process";
import { Command } from "../types";

// `marvin disable` stops the daemon and disables it from starting at boot
export default class DisableCommand extends Command {
  async exec() {
    this.logger.debug('[DisableCommand.exec]');

    try {
      // stop service
      if (this.engine.isDry) {
        this.logger.info('[dry]', 'stop service: systemctl --user stop marvin');
        this.logger.info('[dry]', 'disable service: systemctl --user disable marvin');
      } else {
        this.logger.debug('[DisableCommand.exec]', 'stopping service...');
        // stop and disable
        execSync(['systemctl', '--user', 'stop', 'marvin'].join(' '), { stdio: 'inherit' });
        execSync(['systemctl', '--user', 'disable', 'marvin'].join(' '), { stdio: 'inherit' });
        // check
        const state = execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
        this.logger.info('marvin is', state);
      }
    } catch (err) {
      this.logger.info('marvin is now inactive');
    }

    this.logger.info('marvin disabled');
  }
}
