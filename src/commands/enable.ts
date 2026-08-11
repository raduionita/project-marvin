
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
    const srcLog = join(hpath, 'marvin.log');
    const varLog = '/var/logs/marvin.log';
    if (this.engine.isDry) {
      console.info('[EnableCommand.makeProject]', '[dry]', 'would symlink', varLog, '->', srcLog);
    } else {
      try {
        lstatSync(varLog);
        console.info('[EnableCommand.makeProject]', 'symlink already exists:', varLog);
      } catch {
        try {
          mkdirSync('/var/logs', { recursive: true });
          symlinkSync(srcLog, varLog);
          console.info('created symlink:', varLog, '->', srcLog);
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
      writeFileSync(epath, [
        '# marvin environment variables (systemd EnvironmentFile)',
        '# set to debug|info|warn|error to control log verbosity',
        '# MARVIN_LOG_LEVEL=debug',
        '',
      ].join('\n'));
      console.info('created .env file:', epath);
    } else {
      console.info('~/.marvin/.env exists.', 'skipping');
    }

    console.info('marvin project installed');
  }

  async execService() {
    console.debug('[EnableCommand.execService]');

    // ~/.config/systemd/user/marvin.service
    const srcService = join(this.engine.root, 'marvin.service');
    const dstService = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (this.engine.isDry) {
      console.info('[EnableCommand.execService]', '[dry]', 'would copy service file:', srcService, '->', dstService);
    } else {
      // always refresh the unit file, so re-running enable picks up changes
      // (e.g. StandardOutput/StandardError now pointing at marvin.log)
      mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
      if (!existsSync(srcService)) {
        console.warn('[EnableCommand.execService]', 'service file missing:', srcService);
      } else {
        copyFileSync(srcService, dstService);
        console.debug('[EnableCommand.execService]', 'installed service file:', dstService);
      }
    }

    // start service
    if (this.engine.isDry) {
      console.info('[EnableCommand.execService]', '[dry]', 'enable service: systemctl --user daemon-reload && systemctl --user enable marvin && systemctl --user restart marvin');
    } else {
      console.debug('[EnableCommand.execService]', 'enabling service...');
      execSync(['systemctl', '--user', 'daemon-reload'].join(' '), { stdio: 'inherit' });
      // restart (not "enable --now"): also applies a refreshed unit file to an already-running daemon
      execSync(['systemctl', '--user', 'enable', 'marvin'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'restart', 'marvin'].join(' '), { stdio: 'inherit' });
      // wait for service to start
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

      if (state === 'activating') {
        await delay(1000);
        continue;
      } else if (state === 'active') {
        console.info('marvin service is:', state);
      } else {
        console.error('[EnableCommand.waitForActive]', 'marvin service is stuck in state:', state, 'run "journalctl --user -u marvin -e" for details');
      }
      return;
    }

    console.error('[EnableCommand.waitForActive]', 'marvin service still "activating" after', timeout, 'ms,', 'run "journalctl --user -u marvin -e" for details');
  }
}
