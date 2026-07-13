
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';

export default class UpdateCommand extends Command {
  async init() {
    console.debug('[marvin]', 'UpdateCommand.init');

    const root = join(homedir(), '.local', 'share', 'marvin');

    if (!existsSync(root)) {
      console.error('[marvin] marvin is not installed. run the installer first:');
      console.error('[marvin]   bash install.sh');
      process.exit(1);
    }

    if (!this.ctx.isDry) {
      // git pull from main
      execSync(['git', '-C', root, 'pull', 'origin', 'main'].join(' '), { stdio: 'inherit' });

      // Reinstall dependencies
      console.log('[marvin] reinstalling dependencies...');
      execSync(['bun', 'install'].join(' '), { cwd: root, stdio: 'inherit' });

      // Restart service
      console.log('[marvin] restarting service...');
      execSync(['systemctl', '--user', 'restart', 'marvin'].join(' '), { stdio: 'inherit' });

      console.log('[marvin] update complete');
    } else {
      console.log('[marvin] [dry] git pull origin main');
      console.log('[marvin] [dry] bun install');
      console.log('[marvin] [dry] systemctl --user restart marvin');
      console.log('[marvin] [dry] update complete');
    }
  }
}
