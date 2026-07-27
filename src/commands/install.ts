
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Command } from '../types';
import * as constants from '../constants';

export default class InstallCommand extends Command {
  async load() {
    console.debug('[InstallCommand.load]');
    
    // ~/.marvin
    const hpath = this.ctx.home;
    if (this.ctx.isDry) {
      console.info('[InstallCommand.load]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      console.info('[InstallCommand.load]', 'created workspace directory:', hpath);
    }

    // ~/.marvin/agents
    const apath = join(hpath, 'agents');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.load]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      console.info('[InstallCommand.load]', 'created agents directory:', apath);
    }

    //  ~/.marvin/MARVIN.md
    const mpath = join(hpath, 'MARVIN.md');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.load]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      console.info('[InstallCommand.load]', 'created MARVIN.md:', mpath);
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.load]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      console.info('[InstallCommand.load]', 'created config file:', cpath);
    }    
  }
}
