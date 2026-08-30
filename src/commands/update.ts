
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';
import logger from '../logger.js';

// `marvin update` pull latest changes, reinstall dependencies, restart service
export default class UpdateCommand extends Command {
  async exec() {
    logger.debug('[UpdateCommand.exec]');

    const cmd = this.args[0] || '';
    switch (cmd) {
      case 'help':
        this.execHelp();
      break;
      default:
      case '':
        await this.execUpdate();
      break;
    }
  }

  execHelp() {
    logger.info('usage: marvin update [command]');
    logger.info('commands:');
    logger.info('  help  ', 'show this help');
    logger.info('        ', 'pull latest changes, reinstall dependencies, restart service');
  }

  async execUpdate() {
    logger.debug('[UpdateCommand.execUpdate]');

    const root = join(homedir(), '.local', 'share', 'marvin');

    if (!existsSync(root)) {
      logger.info('marvin is not installed. run the installer first:');
      logger.info('  bash install.sh');
      return;
    }

    // pull project, install dependencies, restart service
    
    // git pull from main
    logger.info('pulling project...');
    execSync(['git', '-C', root, 'pull', 'origin', 'main'].join(' '), { stdio: 'inherit' });

    // Reinstall dependencies
    logger.info('reinstalling dependencies...');
    execSync(['bun', 'install'].join(' '), { cwd: root, stdio: 'inherit' });

    // update service file by copy
    logger.info('updating service file...');
    const src = join(root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    copyFileSync(src, dst);

    // Restart service
    logger.info('restarting service...');
    execSync(['systemctl', '--user', 'restart', 'marvin'].join(' '), { stdio: 'inherit' });

    logger.info('marvin updated');
  }
}
