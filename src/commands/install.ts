
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Command } from '../types';
import * as constants from '../constants';

// `marvin install` creates workspace folders, MARVIN.md, marvin.json
export default class InstallCommand extends Command {
  async exec() {
    console.debug('[InstallCommand.exec]');
    
    // ~/.marvin
    const hpath = this.engine.work;
    if (this.engine.isDry) {
      console.info('[InstallCommand.exec]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      console.debug('[InstallCommand.exec]', 'created workspace directory:', hpath);
    } else {
      console.debug('[InstallCommand.exec]', '~/.marvin exists');
    }

    // ~/.marvin/agents
    const apath = join(hpath, 'agents');
    if (this.engine.isDry) {
      console.info('[InstallCommand.exec]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      console.debug('[InstallCommand.exec]', 'created agents directory:', apath);
    } else {
      console.debug('[InstallCommand.exec]', '~/.marvin/agents exists');
    }

    //  ~/.marvin/MARVIN.md
    const mpath = join(hpath, 'MARVIN.md');
    if (this.engine.isDry) {
      console.info('[InstallCommand.exec]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      console.debug('[InstallCommand.exec]', 'created MARVIN.md:', mpath);
    } else {
      console.debug('[InstallCommand.exec]', '~/.marvin/MARVIN.md exists');
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.engine.isDry) {
      console.info('[InstallCommand.exec]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      console.debug('[InstallCommand.exec]', 'created config file:', cpath);
    } else {
      console.debug('[InstallCommand.exec]', '~/.marvin/marvin.json exists');
    }

    console.debug('[InstallCommand.exec]', 'marvin installed');
  }
}
