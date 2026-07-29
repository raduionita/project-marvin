
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Command } from '../types';
import * as constants from '../constants';

export default class InstallCommand extends Command {
  async exec() {
    console.debug('[InstallCommand.exec]');
    
    // ~/.marvin
    const hpath = this.ctx.home;
    if (this.ctx.isDry) {
      console.info('[InstallCommand.exec]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      console.info('[InstallCommand.exec]', 'created workspace directory:', hpath);
    } else {
      console.info('[InstallCommand.exec]', '~/.marvin exists');
    }

    // ~/.marvin/agents
    const apath = join(hpath, 'agents');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.exec]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      console.info('[InstallCommand.exec]', 'created agents directory:', apath);
    } else {
      console.info('[InstallCommand.exec]', '~/.marvin/agents exists');
    }

    //  ~/.marvin/MARVIN.md
    const mpath = join(hpath, 'MARVIN.md');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.exec]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      console.info('[InstallCommand.exec]', 'created MARVIN.md:', mpath);
    } else {
      console.info('[InstallCommand.exec]', '~/.marvin/MARVIN.md exists');
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.ctx.isDry) {
      console.info('[InstallCommand.exec]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      console.info('[InstallCommand.exec]', 'created config file:', cpath);
    } else {
      console.info('[InstallCommand.exec]', '~/.marvin/marvin.json exists');
    }

    console.info('[InstallCommand.exec]', 'installation complete');
  }
}
