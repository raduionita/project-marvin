
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';
import * as constants from '../constants';

export default class InitCommand extends Command {
  async load() {
    console.debug('[InitCommand.load]');
    await this.loadProject();
    await this.loadService();
  }

  async loadProject() {
    console.debug('[InitCommand.loadProject]');

    // set root to the app folder (where package.json lives)
    this.ctx!.root = import.meta.url.replace('file://', '').replace(/\\/g, '/').replace(/\/src\/commands\/setup\.ts$/, '');
    console.info('[InitCommand.loadProject]', 'root directory:', this.ctx.root);

    // create project/workspace folder (~/.marvin)
    const hpath = join(homedir(), '.marvin');
    if (this.ctx.isDry) {
      console.info('[InitCommand.loadProject]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      console.info('[InitCommand.loadProject]', 'created workspace directory:', hpath);
    }

    // set home (~/.marvin)
    this.ctx!.home = hpath;

    // agents folder (~/.marvin/agents)
    const apath = join(hpath, 'agents');
    if (this.ctx.isDry) {
      console.info('[InitCommand.loadProject]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      console.info('[InitCommand.loadProject]', 'created agents directory:', apath);
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(hpath, 'MARVIN.md');
    if (this.ctx.isDry) {
      console.info('[InitCommand.loadProject]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      console.info('[InitCommand.loadProject]', 'created MARVIN.md:', mpath);
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.ctx.isDry) {
      console.info('[InitCommand.loadProject]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      console.info('[InitCommand.loadProject]', 'created config file:', cpath);
    }
  }

  async loadService() {
    console.debug('[InitCommand.loadService]');

    // check if daemon is already running
    if (this.ctx.isDry) {
      console.info('[InitCommand.loadService]', '[dry]', 'would check if daemon is already running');
    } else {
      try {
        const status = execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
        if (status === 'active') {
          console.info('[InitCommand.loadService]', 'marvin daemon is already running. use "marvin reload" to apply config changes');
          return;
        }
      } catch {
        console.error('[InitCommand.loadService]', 'marvin daemon is not running.');
      }
    }

    // install systemd service
    const src = join(this.ctx!.root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (this.ctx.isDry) {
      console.info('[InitCommand.loadService]', '[dry]', 'would copy service file:', src, '->', dst);
    } else if (!existsSync(src)) {
      console.warn('[InitCommand.loadService]', 'service file missing:', src);
      mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
      copyFileSync(src, dst);
    }

    // start service
    if (this.ctx.isDry) {
      console.info('[InitCommand.loadService]', '[dry]', 'enable service: systemctl --user daemon-reload && systemctl --user enable --now marvin');
    } else {
      console.info('[InitCommand.loadService]', 'enabling service...');
      execSync(['systemctl', '--user', 'daemon-reload'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'enable', '--now', 'marvin'].join(' '), { stdio: 'inherit' });
    }
    
    console.info('[InitCommand.loadService]', 'bootstrap complete');
  }
}
