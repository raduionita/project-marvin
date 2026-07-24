
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Command } from '../types';
import * as constants from '../constants';

export default class InstallCommand extends Command {
  async load() {
    console.debug('[InstallCommand.load]');
    await this.loadProject();
  }

  async loadProject() {
    console.debug('[InstallCommand.loadProject]');

    // set root to the app folder (where package.json lives)
    this.ctx.root = import.meta.url.replace('file://', '').replace(/\\/g, '/').replace(/\/src\/commands\/setup\.ts$/, '');
    console.info('[InstallCommand.loadProject]', 'root directory:', this.ctx.root);

    // ~/.marvin
    const hpath = join(homedir(), '.marvin');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.loadProject]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      console.info('[InstallCommand.loadProject]', 'created workspace directory:', hpath);
    }

    // set home (~/.marvin)
    this.ctx.home = hpath;

    // ~/.marvin/agents
    const apath = join(hpath, 'agents');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.loadProject]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      console.info('[InstallCommand.loadProject]', 'created agents directory:', apath);
    }

    //  ~/.marvin/MARVIN.md
    const mpath = join(hpath, 'MARVIN.md');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.loadProject]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      console.info('[InstallCommand.loadProject]', 'created MARVIN.md:', mpath);
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.loadProject]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      console.info('[InstallCommand.loadProject]', 'created config file:', cpath);
    }
  }
}
