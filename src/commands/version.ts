
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, } from 'fs';
import { Command } from '../types';
import logger from '../logger.js';

// `marvin version` prints the current version
export default class VersionCommand extends Command {
  async exec() {
    logger.debug('[VersionCommand.exec]');

    const root = join(homedir(), '.local', 'share', 'marvin');
    const pkgPath = join(root, 'package.json');

    if (!existsSync(pkgPath)) {
      logger.error('[VersionCommand.exec]', 'package.json not found.');
      return;
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const version = pkg.version || 'unknown';
    
    logger.info('mArvIn version:', version);
  }
}
