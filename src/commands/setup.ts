
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';
import * as constants from '../constants';

export default class SetupCommand extends Command {
  async init() {
    console.debug('[marvin]', 'SetupCommand.init');
    await this.initProject();
    await this.initService();
  }

  async initProject() {
    console.debug('[marvin]', 'SetupCommand.initProject');

    // set root to the app folder (where package.json lives)
    this.ctx!.root = import.meta.url.replace('file://', '').replace(/\\/g, '/').replace(/\/src\/client\.ts$/, '');

    // create project/workspace folder (~/.marvin)
    const home = join(homedir(), '.marvin');
    if (!existsSync(home)) {
      if (!this.ctx.isDry) {
        mkdirSync(home, { recursive: true });
        console.info('[marvin]', 'created workspace directory:', home);
      } else {
        console.info('[marvin]', '[dry] would create workspace directory:', home);
      }
    }

    // set home (~/.marvin)
    this.ctx!.home = home;

    // agents folder (~/.marvin/agents)
    const apath = join(home, 'agents');
    if (!existsSync(apath)) {
      if (!this.ctx.isDry) {
        mkdirSync(apath, { recursive: true });
        console.info('[marvin]', 'created agents directory:', apath);
      } else {
        console.info('[marvin]', '[dry] would create agents directory:', apath);
      }
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(home, 'MARVIN.md');
    if (!existsSync(mpath)) {
      if (!this.ctx.isDry) {
        writeFileSync(mpath, constants.MARVIN_MD.trim());
        console.info('[marvin]', 'created MARVIN.md:', mpath);
      } else {
        console.debug('[marvin]', '[dry] would write MARVIN.md file:', mpath);
      }
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(home, 'marvin.json');
    if (!existsSync(cpath)) {
      if (!this.ctx.isDry) {
        const config = constants.DEFAULT_CONFIG;
        writeFileSync(cpath, JSON.stringify(config, null, 2));
        console.info('[marvin]', 'created config file:', cpath);
      } else {
        console.info('[marvin]', '[dry] would write config file:', cpath);
      }
    }
  }

  async initService() {
    console.debug('[marvin]', 'SetupCommand.initService');

    // check if daemon is already running
    if (!this.ctx.isDry) {
      try {
        const status = execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
        if (status === 'active') {
          console.info('[marvin]', 'marvin daemon is already running. use "marvin reload" to apply config changes');
          return;
        }
      } catch {
        console.info('[marvin]', 'marvin daemon is not running.');
      }
    } else {
      console.info('[marvin]', '[dry] would check if daemon is already running');
    }

    // install systemd service
    const src = join(this.ctx!.root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (!existsSync(src)) {
      console.error('[marvin]', 'service file missing:', src);
      return;
    }

    if (!this.ctx.isDry) {
      mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
      copyFileSync(src, dst);
      console.info('[marvin]', 'service file installed:', dst);
    } else {
      console.info('[marvin]', '[dry] would copy service file:', src, '->', dst);
      return;
    }

    // ensure workspace
    console.info('[marvin]', 'workspace directory:', this.ctx!.home);
    console.info('[marvin]', 'bootstrap complete.');
    console.info('[marvin]', 'configure', join(this.ctx!.home, 'marvin.json'), 'with your models and channels');
    console.info('[marvin]', 'run: systemctl --user daemon-reload && systemctl --user enable --now marvin');
  }
}
