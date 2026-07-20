
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, } from 'fs';
import { Command } from '../types';

export default class VersionCommand extends Command {
  async init() {
    console.debug('[VersionCommand.init]');

    const root = join(homedir(), '.local', 'share', 'marvin');
    const pkgPath = join(root, 'package.json');

    if (!existsSync(pkgPath)) {
      console.error('[VersionCommand.init]', 'package.json not found.');
      return;
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const version = pkg.version || 'unknown';
    console.log('[VersionCommand.init]', 'v' + version);
  }
}
