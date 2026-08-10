
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from '../types';
import * as constants from '../constants';
import { delay } from '../helpers';

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

    // /var/logs/marvin.log -> ~/.marvin/marvin.log (system log access)
    const realLog = join(hpath, 'marvin.log');
    const sysLog = '/var/logs/marvin.log';
    if (this.engine.isDry) {
      console.info('[EnableCommand.makeProject]', '[dry]', 'would symlink', sysLog, '->', realLog);
    } else {
      try {
        lstatSync(sysLog);
        console.info('[EnableCommand.makeProject]', 'symlink already exists:', sysLog);
      } catch {
        try {
          mkdirSync('/var/logs', { recursive: true });
          symlinkSync(realLog, sysLog);
          console.info('[EnableCommand.makeProject]', 'created symlink:', sysLog, '->', realLog);
        } catch (err) {
          console.warn('[EnableCommand.makeProject]', 'cannot create symlink (retry with sudo):', (err as Error).message);
        }
      }
    }

    // ~/.marvin/.env (systemd EnvironmentFile must exist or the unit will never start)
    const epath = join(hpath, '.env');
    if (this.engine.isDry) {
      console.info('[EnableCommand.makeProject]', '[dry]', epath);
    } else if (!existsSync(epath)) {
      writeFileSync(epath, '', { flag: 'a' });
      console.info('[EnableCommand.makeProject]', 'created .env file:', epath);
    } else {
      console.info('[EnableCommand.makeProject]', '~/.marvin/.env exists');
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
        console.debug('[EnableCommand.execService]', 'marvin daemon is not running.');
      }
    }

    // ~/.config/systemd/user/marvin.service
    const src = join(this.engine.root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (this.engine.isDry) {
      console.info('[EnableCommand.execService]', '[dry]', 'would copy service file:', src, '->', dst);
    } else if (!existsSync(dst)) {
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
      await this.waitForActive();
    }
    
    console.debug('[EnableCommand.execService]', 'marvin enabled');
  }

  // poll the service until it settles, so we can diagnose a stuck "activating"
  async waitForActive(timeout = 15000) {
    console.debug('[EnableCommand.waitForActive]');

    for (let waited = 0; waited < timeout; waited += 1000) {
      let state = '';
      try {
        state = execSync(['systemctl', '--user', 'is-active', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
      } catch (err) {
        state = ((err as { stdout?: string }).stdout || '').trim() || 'failed';
      }

      if (state !== 'activating') {
        if (state === 'active') {
          console.info('[EnableCommand.waitForActive]', 'marvin service is:', state);
        } else {
          console.error('[EnableCommand.waitForActive]', 'marvin service is stuck in state:', state,
            'run "journalctl --user -u marvin -e" for details');
        }
        return;
      }
      await delay(1000);
    }

    console.error('[EnableCommand.waitForActive]', 'marvin service still "activating" after', timeout, 'ms,',
      'run "journalctl --user -u marvin -e" for details');
  }
}
