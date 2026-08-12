
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Command } from '../types';
import * as constants from '../constants';

// `marvin install` creates workspace folders, MARVIN.md, marvin.json
export default class InstallCommand extends Command {
  async exec() {
    console.debug('[InstallCommand.exec]');
    
    await this.makeProject();
  }

  async makeProject() {
    // ~/.marvin
    const hpath = this.engine.work;
    if (this.engine.isDry) {
      console.info('[InstallCommand.makeProject]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      console.info('created workspace directory:', hpath);
    } else {
      console.info('directory', hpath, 'exists');
    }

    // ~/.marvin/agents
    const apath = join(hpath, 'agents');
    if (this.engine.isDry) {
      console.info('[InstallCommand.makeProject]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      console.info('created agents directory:', apath);
    } else {
      console.info('directory', apath, 'exists');
    }

    // ~/.marvin/skills
    const kpath = join(hpath, 'skills');
    if (this.engine.isDry) {
      console.info('[InstallCommand.makeProject]', '[dry]', kpath);
    } else if (!existsSync(kpath)) {
      mkdirSync(kpath, { recursive: true });
      console.info('created skills directory:', kpath);
    } else {
      console.info('directory', kpath, 'exists');
    }

    // ~/.marvin/tools
    const tpath = join(hpath, 'tools');
    if (this.engine.isDry) {
      console.info('[InstallCommand.makeProject]', '[dry]', tpath);
    } else if (!existsSync(tpath)) {
      mkdirSync(tpath, { recursive: true });
      console.info('created tools directory:', tpath);
    } else {
      console.info('directory', tpath, 'exists');
    }

    //  ~/.marvin/MARVIN.md
    const mpath = join(hpath, 'MARVIN.md');
    if (this.engine.isDry) {
      console.info('[InstallCommand.makeProject]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      console.info('created MARVIN.md:', mpath);
    } else {
      console.info('marvin identity', mpath, 'exists');
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.engine.isDry) {
      console.info('[InstallCommand.exec]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      console.info('created config file:', cpath);
    } else {
      console.info('config file', cpath, 'exists');
    }

    console.info('marvin installed!');
  }
}
