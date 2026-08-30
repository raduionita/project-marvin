import { execSync } from "node:child_process";
import { Command } from "../types";
import logger from '../logger.js';

// `marvin disable` stops the daemon and disables it from starting at boot
export default class DisableCommand extends Command {
  async exec() {
    logger.debug('[DisableCommand.exec]');
    switch (this.args[0]) {
      case 'help':
        this.execHelp();
      break;
      case 'tool': break;
      case 'integration': break;
      case 'mcp': break;
      default:
        await this.execDisable();
      break;
    }
  }

  execHelp() {
    logger.info('usage: marvin disable [command]');
    logger.info('commands:');
    logger.info('  help  ', 'show this help');
    logger.info('        ', 'stop the daemon and disable it from starting at boot');
  }

  async execDisable() {
    logger.debug('[DisableCommand.execDisable]');
    
    try {
      // stop service
      logger.debug('[DisableCommand.execDisable]', 'stopping service...');
      // stop and disable
      execSync(['systemctl', '--user', 'stop', 'marvin'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'disable', 'marvin'].join(' '), { stdio: 'inherit' });
      // check
      const state = execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
      // output
      logger.info('marvin is', state);
    } catch (err) {
      logger.info('marvin is now inactive');
    }

    logger.info('marvin disabled');
  }
}
