
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';

export default class UpdateCommand extends Command {
  async init() {
    console.debug('[UpdateCommand.init]');

    const root = join(homedir(), '.local', 'share', 'marvin');

    if (!existsSync(root)) {
      console.error('[UpdateCommand.init]', 'marvin is not installed. run the installer first:');
      console.error('[UpdateCommand.init]', '  bash install.sh');
      return;
    }

    // pull project, install dependencies, restart service
    if (this.ctx.isDry) {
      console.log('[UpdateCommand.init]', '[dry]', 'pull project:', ['git', '-C', root, 'pull', 'origin', 'main'].join(' '));
      console.log('[UpdateCommand.init]', '[dry]', 'install dependencies:', ['bun', 'install'].join(' '));
      console.log('[UpdateCommand.init]', '[dry]', 'restart service:', ['systemctl', '--user', 'restart', 'marvin'].join(' '));
    } else {
      // git pull from main
      console.info('[UpdateCommand.init]', 'pulling project...');
      execSync(['git', '-C', root, 'pull', 'origin', 'main'].join(' '), { stdio: 'inherit' });

      // Reinstall dependencies
      console.info('[UpdateCommand.init]', 'reinstalling dependencies...');
      execSync(['bun', 'install'].join(' '), { cwd: root, stdio: 'inherit' });

      // update service file by copy
      console.info('[UpdateCommand.init]', 'updating service file...');
      const src = join(root, 'marvin.service');
      const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
      copyFileSync(src, dst);

      // Restart service
      console.info('[UpdateCommand.init]', 'restarting service...');
      execSync(['systemctl', '--user', 'restart', 'marvin'].join(' '), { stdio: 'inherit' });
    }

    console.info('[UpdateCommand.init]', 'update complete');
  }
}
