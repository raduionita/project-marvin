
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, } from 'fs';
import { Command } from '../types';

// `marvin version` prints the current version
export default class VersionCommand extends Command {
  async exec() {
    this.logger.debug('[VersionCommand.exec]');

    const root = join(homedir(), '.local', 'share', 'marvin');
    const pkgPath = join(root, 'package.json');

    if (!existsSync(pkgPath)) {
      this.logger.error('[VersionCommand.exec]', 'package.json not found.');
      return;
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const version = pkg.version || 'unknown';
    
    this.logger.info('mArvIn version:', version);
  }
}
