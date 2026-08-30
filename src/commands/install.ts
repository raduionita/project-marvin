
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Command } from '../types';
import * as constants from '../constants';
import logger from '../logger.js';

// `marvin install` creates workspace folders, MARVIN.md, marvin.json
export default class InstallCommand extends Command {
  async exec() {
    logger.debug('[InstallCommand.exec]');
    
    await this.makeProject();
  }

  async makeProject() {
    // ~/.marvin
    const hpath = this.engine.work;
    if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      logger.info('created workspace directory:', hpath);
    } else {
      logger.info('directory', hpath, 'exists');
    }

    // ~/.marvin/agents
    const apath = join(hpath, 'agents');
    if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      logger.info('created agents directory:', apath);
    } else {
      logger.info('directory', apath, 'exists');
    }

    // ~/.marvin/skills
    const kpath = join(hpath, 'skills');
    if (!existsSync(kpath)) {
      mkdirSync(kpath, { recursive: true });
      logger.info('created skills directory:', kpath);
    } else {
      logger.info('directory', kpath, 'exists');
    }

    // ~/.marvin/tools
    const tpath = join(hpath, 'tools');
    if (!existsSync(tpath)) {
      mkdirSync(tpath, { recursive: true });
      logger.info('created tools directory:', tpath);
    } else {
      logger.info('directory', tpath, 'exists');
    }

    // ~/.marvin/logs (daemon log file lives here)
    const lpath = join(hpath, 'logs');
    if (!existsSync(lpath)) {
      mkdirSync(lpath, { recursive: true });
      logger.info('created logs directory:', lpath);
    } else {
      logger.info('directory', lpath, 'exists');
    }

    // ~/.marvin/memories (persistent memory notes live here)
    const memPath = join(hpath, 'memories');
    if (!existsSync(memPath)) {
      mkdirSync(memPath, { recursive: true });
      logger.info('created memories directory:', memPath);
    } else {
      logger.info('directory', memPath, 'exists');
    }

    // ~/.marvin/chats (persisted chat transcripts live here)
    const chatsPath = join(hpath, 'chats');
    if (!existsSync(chatsPath)) {
      mkdirSync(chatsPath, { recursive: true });
      logger.info('created chats directory:', chatsPath);
    } else {
      logger.info('directory', chatsPath, 'exists');
    }

    // ~/.marvin/files
    const fpath = join(hpath, 'files');
    if (!existsSync(fpath)) {
      mkdirSync(fpath, { recursive: true });
      logger.info('created agents directory:', fpath);
    } else {
      logger.info('directory', fpath, 'exists');
    }

    //  ~/.marvin/MARVIN.md
    const mpath = join(hpath, 'MARVIN.md');
    if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      logger.info('created MARVIN.md:', mpath);
    } else {
      logger.info('marvin identity', mpath, 'exists');
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      logger.info('created config file:', cpath);
    } else {
      logger.info('config file', cpath, 'exists');
    }

    logger.info('marvin installed!');
  }
}
