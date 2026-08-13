
import { homedir } from 'os';
import { join, dirname } from 'path';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { delay } from '../helpers';
import InstallCommand from './install';

// `marvin enable` installs the workspace + systemd unit and starts the daemon
export default class EnableCommand extends InstallCommand {
  async exec() {
    this.logger.debug('[EnableCommand.exec]');

    await this.makeProject();
    await this.execSystemd();
  }

  async execSystemd() {
    this.logger.debug('[EnableCommand.execSystemd]');

    const hpath = this.engine.work;

    // ~/.marvin/.env (systemd EnvironmentFile must exist or the unit will never start)
    const epath = join(hpath, '.env');
    if (this.engine.isDry) {
      this.logger.info('[dry]', 'write', epath);
    } else if (!existsSync(epath)) {
      writeFileSync(epath, [
        '# marvin environment variables (systemd EnvironmentFile)',
        '# set to debug|info|warn|error to control log verbosity',
        '# MARVIN_LOG_LEVEL=debug',
        '',
      ].join('\n'));
      this.logger.info('created .env file:', epath);
    } else {
      this.logger.info('enm file', epath, 'exists');
    }

    // ~/.bun/bin/bun
    let bpath = join(homedir(), '.bun', 'bin', 'bun');
    try {
      bpath = execSync('command -v bun', { encoding: 'utf8' }).trim();
    } catch { /* not on PATH, fall back to the default bun install location */ }

    // ~/.local/bin/marvin
    const wpath = join(homedir(), '.local', 'bin', 'marvin');
    if (this.engine.isDry) {
      this.logger.info('[dry]', 'would ensure wrapper:', wpath);
    } else {
      mkdirSync(dirname(wpath), { recursive: true });
      writeFileSync(wpath, `#!/bin/sh\nexec "${bpath}" "${join(this.engine.root, 'src', 'marvin.ts')}" "$@"\n`, { mode: 0o755 });
      this.logger.info('created wrapper:', wpath, 'bun =', bpath);
    }

    // ~/.config/systemd/user/marvin.service
    const spath = join(this.engine.root, 'marvin.service');
    const dpath = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (this.engine.isDry) {
      this.logger.info('[dry]', 'would write service file:', dpath);
    } else if (!existsSync(spath)) {
      this.logger.error('[EnableCommand.execSystemd]', 'service file missing:', spath);
    } else {
      // always refresh the unit so re-running enable picks up changes
      mkdirSync(dirname(dpath), { recursive: true });
      copyFileSync(spath, dpath);
      this.logger.info('installed service file:', dpath);
    }

    // start service
    if (this.engine.isDry) {
      this.logger.info('[dry]', 'enable service: systemctl --user daemon-reload && systemctl --user enable marvin && systemctl --user restart marvin');
    } else {
      this.logger.debug('[EnableCommand.execSystemd]', 'enabling service...');
      execSync(['systemctl', '--user', 'daemon-reload'].join(' '), { stdio: 'inherit' });
      // restart (not "enable --now"): also applies a refreshed unit file to an already-running daemon
      execSync(['systemctl', '--user', 'enable', 'marvin'].join(' '), { stdio: 'inherit' });
      execSync(['systemctl', '--user', 'restart', 'marvin'].join(' '), { stdio: 'inherit' });
      // wait for the service to start
      await this.waitForActive();
    }

    this.logger.info('marvin enabled!');
  }

  // poll the service until it settles, so we can diagnose a stuck "activating"
  async waitForActive(timeout = 15000) {
    this.logger.debug('[EnableCommand.waitForActive]');

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
        this.logger.info('marvin service is:', state);
      } else {
        this.logger.error('[EnableCommand.waitForActive]', 'marvin service is stuck in state:', state, 'run "journalctl --user -u marvin -e" for details');
      }
      return;
    }

    this.logger.error('[EnableCommand.waitForActive]', 'marvin service still "activating" after', timeout, 'ms,', 'run "journalctl --user -u marvin -e" for details');
  }
}
