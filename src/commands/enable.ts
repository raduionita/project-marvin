
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';
import * as constants from '../constants';

// `marvin enable` install + start the daemon
export default class EnableCommand extends Command {
  async exec() {
    console.debug('[EnableCommand.exec]');
    
    await this.makeProject();

    await this.execService();
  }

  async makeProject() {
    console.debug('[EnableCommand.makeProject]', 'checking if project is already installed and install it if not');

    // ~/.marvin
    const hpath = this.engine.work;
    if (this.engine.isDry) {
      console.info('[EnableCommand.makeProject]', '[dry]', hpath);
    } else if (!existsSync(hpath)) {
      mkdirSync(hpath, { recursive: true });
      console.info('[EnableCommand.makeProject]', 'created workspace directory:', hpath);
    } else {
      console.info('[EnableCommand.makeProject]', '~/.marvin exists');
    }

    // ~/.marvin/agents
    const apath = join(hpath, 'agents');
    if (this.engine.isDry) {
      console.info('[EnableCommand.makeProject]', '[dry]', apath);
    } else if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
      console.info('[EnableCommand.makeProject]', 'created agents directory:', apath);
    } else {
      console.info('[EnableCommand.makeProject]', '~/.marvin/agents exists');
    }

    //  ~/.marvin/MARVIN.md
    const mpath = join(hpath, 'MARVIN.md');
    if (this.engine.isDry) {
      console.info('[EnableCommand.makeProject]', '[dry]', mpath);
    } else if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
      console.info('[EnableCommand.makeProject]', 'created MARVIN.md:', mpath);
    } else {
      console.info('[EnableCommand.makeProject]', '~/.marvin/MARVIN.md exists');  
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(hpath, 'marvin.json');
    if (this.engine.isDry) {
      console.info('[EnableCommand.makeProject]', '[dry]', cpath);
    } else if (!existsSync(cpath)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(cpath, JSON.stringify(config, null, 2));
      console.info('[EnableCommand.makeProject]', 'created config file:', cpath);
    } else {
      console.info('[EnableCommand.makeProject]', '~/.marvin/marvin.json exists');
    }

    console.info('[EnableCommand.makeProject]', 'project installed');
  }

  async execService() {
    console.debug('[EnableCommand.execService]');

    // check if daemon is already running
    if (this.engine.isDry) {
      console.info('[EnableCommand.execService]', '[dry]', 'would check if daemon is already running');
    } else {
      try {
        const status = execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
        if (status === 'active') {
          console.debug('[EnableCommand.execService]', 'marvin daemon is already running. use "marvin reload" to apply config changes');
          return;
        }
        console.debug('[EnableCommand.execService]', `marvin daemon is ${status}`);
      } catch {
        console.error('[EnableCommand.execService]', 'marvin daemon is not running.');
      }
    }

    // ~/.config/systemd/user/marvin.service
    const src = join(this.engine!.root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (this.engine.isDry) {
      console.info('[EnableCommand.execService]', '[dry]', 'would copy service file:', src, '->', dst);
    } else if (!existsSync(src)) {
      console.warn('[EnableCommand.execService]', 'service file missing:', src);
      mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
      copyFileSync(src, dst);
    }

    // start service
    if (this.engine.isDry) {
      console.info('[EnableCommand.execService]', '[dry]', 'enable service: systemctl --user daemon-reload && systemctl --user enable --now marvin');
    } else {
      console.debug('[EnableCommand.execService]', 'enabling service...');
      execSync(['systemctl', '--user', 'daemon-reload'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'enable', '--now', 'marvin'].join(' '), { stdio: 'inherit' });
    }
    
    console.debug('[EnableCommand.execService]', 'marvin enabled');
  }
}
