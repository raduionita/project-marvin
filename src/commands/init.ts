
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';
import * as constants from '../constants';

export default class InitCommand extends Command {
  async init() {
    console.debug('[InitCommand.init]');
    await this.initProject();
    await this.initService();
  }

  async initProject() {
    console.debug('[InitCommand.initProject]');

    // set root to the app folder (where package.json lives)
    this.ctx!.root = import.meta.url.replace('file://', '').replace(/\\/g, '/').replace(/\/src\/commands\/setup\.ts$/, '');
    console.info('root directory:', this.ctx.root);

    // create project/workspace folder (~/.marvin)
    const hpath = join(homedir(), '.marvin');
    if (this.ctx.isDry) {
      console.info('[dry]', hpath);
    } else if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      console.info('created workspace directory:', hpath);
    }

    // set home (~/.marvin)
    this.ctx!.home = hpath;

    // agents folder (~/.marvin/agents)
    const apath = join(hpath, 'agents');
    if (this.ctx.isDry) {
      console.info('[dry]', apath);
    } else if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      console.info('created agents directory:', apath);
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(hpath, 'MARVIN.md');
    if (this.ctx.isDry) {
      console.info('[dry]', mpath);
    } else if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      console.info('created MARVIN.md:', mpath);
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.ctx.isDry) {
      console.info('[dry]', cpath);
    } else if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      console.info('created config file:', cpath);
    }
  }

  async initService() {
    console.debug('[InitCommand.initService]');

    // check if daemon is already running
    if (this.ctx.isDry) {
      console.info('[dry]', 'would check if daemon is already running');
    } else {
      try {
        const status = execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
        if (status === 'active') {
          console.info('marvin daemon is already running. use "marvin reload" to apply config changes');
          return;
        }
      } catch {
        console.error('[InitCommand.initService]', 'marvin daemon is not running.');
      }
    }

    // install systemd service
    const src = join(this.ctx!.root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (this.ctx.isDry) {
      console.info('[dry]', 'would copy service file:', src, '->', dst);
    } else if (!existsSync(src)) {
      console.warn('service file missing:', src);
      mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
      copyFileSync(src, dst);
    }

    // start service
    if (this.ctx.isDry) {
      console.info('[dry]', 'enable service: systemctl --user daemon-reload && systemctl --user enable --now marvin');
    } else {
      console.info('enabling service...');
      execSync(['systemctl', '--user', 'daemon-reload'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'enable', '--now', 'marvin'].join(' '), { stdio: 'inherit' });
    }
    
    console.info('bootstrap complete');
  }
}
