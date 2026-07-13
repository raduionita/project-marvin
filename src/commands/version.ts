
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, } from 'fs';
import { Command } from '../types';

export default class VersionCommand extends Command {
  async init() {
    console.debug('[marvin]', 'VersionCommand.init');

    const root = join(homedir(), '.local', 'share', 'marvin');
    const pkgPath = join(root, 'package.json');

    if (!existsSync(pkgPath)) {
      console.error('[marvin]', 'package.json not found.');
      process.exit(1);
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const version = pkg.version || 'unknown';
    console.log('[marvin]', 'v' + version);
  }
}
