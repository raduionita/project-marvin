
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';
import * as constants from '../constants';

export default class EnableCommand extends Command {
  async load() {
    console.debug('[EnableCommand.load]');
    await this.loadProject();
    await this.loadService();
  }

  async loadProject() {
    console.debug('[EnableCommand.loadProject]', 'checking if project is already installed and install it if not');

    // ~/.marvin
    const hpath = this.ctx.home;
    if (this.ctx.isDry) {
      console.info('[EnableCommand.loadProject]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      console.info('[EnableCommand.loadProject]', 'created workspace directory:', hpath);
    }

    // ~/.marvin/agents
    const apath = join(hpath, 'agents');
    if (this.ctx.isDry) {
      console.info('[EnableCommand.loadProject]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      console.info('[EnableCommand.loadProject]', 'created agents directory:', apath);
    }

    //  ~/.marvin/MARVIN.md
    const mpath = join(hpath, 'MARVIN.md');
    if (this.ctx.isDry) {
      console.info('[EnableCommand.loadProject]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      console.info('[EnableCommand.loadProject]', 'created MARVIN.md:', mpath);
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.ctx.isDry) {
      console.info('[EnableCommand.loadProject]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      console.info('[EnableCommand.loadProject]', 'created config file:', cpath);
    }
  }

  async loadService() {
    console.debug('[EnableCommand.loadService]');

    // check if daemon is already running
    if (this.ctx.isDry) {
      console.info('[EnableCommand.loadService]', '[dry]', 'would check if daemon is already running');
    } else {
      try {
        const status = execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
        if (status === 'active') {
          console.info('[EnableCommand.loadService]', 'marvin daemon is already running. use "marvin reload" to apply config changes');
          return;
        }
        console.info('[EnableCommand.loadService]', `marvin daemon is ${status}`);
      } catch {
        console.error('[EnableCommand.loadService]', 'marvin daemon is not running.');
      }
    }

    // ~/.config/systemd/user/marvin.service
    const src = join(this.ctx!.root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (this.ctx.isDry) {
      console.info('[EnableCommand.loadService]', '[dry]', 'would copy service file:', src, '->', dst);
    } else if (!existsSync(src)) {
      console.warn('[EnableCommand.loadService]', 'service file missing:', src);
      mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
      copyFileSync(src, dst);
    }

    // start service
    if (this.ctx.isDry) {
      console.info('[EnableCommand.loadService]', '[dry]', 'enable service: systemctl --user daemon-reload && systemctl --user enable --now marvin');
    } else {
      console.info('[EnableCommand.loadService]', 'enabling service...');
      execSync(['systemctl', '--user', 'daemon-reload'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'enable', '--now', 'marvin'].join(' '), { stdio: 'inherit' });
    }
    
    console.info('[EnableCommand.loadService]', 'bootstrap complete');
  }
}
