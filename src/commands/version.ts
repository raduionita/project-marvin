
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, } from 'fs';
import { Command } from '../types';

export default class VersionCommand extends Command {
  async load() {
    console.debug('[VersionCommand.load]');

    const root = join(homedir(), '.local', 'share', 'marvin');
    const pkgPath = join(root, 'package.json');

    if (!existsSync(pkgPath)) {
      console.error('[VersionCommand.load]', 'package.json not found.');
      return;
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const version = pkg.version || 'unknown';
    console.log('[VersionCommand.load]', 'v' + version);
  }
}
