
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';

// `marvin update [--dry]` pull latest changes, reinstall dependencies, restart service
export default class UpdateCommand extends Command {
  async exec() {
    this.logger.debug('[UpdateCommand.exec]');

    const root = join(homedir(), '.local', 'share', 'marvin');

    if (!existsSync(root)) {
      this.logger.info('marvin is not installed. run the installer first:');
      this.logger.info('  bash install.sh');
      return;
    }

    // pull project, install dependencies, restart service
    if (this.engine.isDry) {
      this.logger.info('[dry]', 'pull project:', ['git', '-C', root, 'pull', 'origin', 'main'].join(' '));
      this.logger.info('[dry]', 'install dependencies:', ['bun', 'install'].join(' '));
      this.logger.info('[dry]', 'restart service:', ['systemctl', '--user', 'restart', 'marvin'].join(' '));
    } else {
      // git pull from main
      this.logger.debug('[UpdateCommand.exec]', 'pulling project...');
      execSync(['git', '-C', root, 'pull', 'origin', 'main'].join(' '), { stdio: 'inherit' });

      // Reinstall dependencies
      this.logger.debug('[UpdateCommand.exec]', 'reinstalling dependencies...');
      execSync(['bun', 'install'].join(' '), { cwd: root, stdio: 'inherit' });

      // update service file by copy
      this.logger.debug('[UpdateCommand.exec]', 'updating service file...');
      const src = join(root, 'marvin.service');
      const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
      copyFileSync(src, dst);

      // Restart service
      this.logger.debug('[UpdateCommand.exec]', 'restarting service...');
      execSync(['systemctl', '--user', 'restart', 'marvin'].join(' '), { stdio: 'inherit' });
    }

    this.logger.info('marvin updated');
  }
}
