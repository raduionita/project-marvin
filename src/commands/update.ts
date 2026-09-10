
import { homedir } from 'os';
import { join, dirname } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { Command } from '../types';
import { delay } from '../helpers';
import { sh } from '../terminal.js';
import logger from '../logger.js';

// `marvin update` stops the service, updates to the latest release,
// reinstalls dependencies, then restarts the service
export default class UpdateCommand extends Command {
  async exec() {
    logger.debug('[UpdateCommand.exec]');

    switch (this.args[0] || '') {
      case 'help':
        this.execHelp();
      break;
      case '':
        await this.execUpdate();
      break;
      default:
        logger.error('[UpdateCommand.exec]', `unknown command: ${this.args[0]}`);
        this.execHelp();
      break;
    }
  }

  execHelp() {
    logger.info('usage: marvin update [command]');
    logger.info('commands:');
    logger.info('  help  ', 'show this help');
    logger.info('        ', 'stop service, update to latest release, reinstall dependencies, restart service');
  }

  async execUpdate() {
    logger.debug('[UpdateCommand.execUpdate]');

    const root = this.engine.root;
    if (!existsSync(root)) {
      logger.info('marvin is not installed. run the installer first:');
      logger.info('  bash install.sh');
      return;
    }

    if (!await this.stopService()) return;
    if (!await this.updateRelease(root)) return;
    if (!await this.installDeps(root)) return;
    if (!await this.restartService(root)) return;

    logger.info('marvin updated');
  }

  async stopService(): Promise<boolean> {
    logger.debug('[UpdateCommand.stopService]');
    logger.info('stopping service...');

    try {
      sh('systemctl --user stop marvin', { stdio: 'inherit' });
    } catch {
      logger.warn('[UpdateCommand.stopService]', 'stop command failed, checking state...');
    }

    try {
      const state = sh('systemctl --user is-active marvin', { encoding: 'utf8' }).trim();
      if (state === 'active' || state === 'activating') {
        logger.error('[UpdateCommand.stopService]', `service still "${state}", aborting update`);
        return false;
      }
      logger.info('service stopped:', state);
    } catch {
      logger.info('service stopped: inactive');
    }
    return true;
  }

  async updateRelease(root: string): Promise<boolean> {
    logger.debug('[UpdateCommand.updateRelease]');
    logger.info('fetching latest release...');

    try {
      sh(`git -C "${root}" fetch --tags origin`, { stdio: 'inherit' });
    } catch (err) {
      logger.error('[UpdateCommand.updateRelease]', 'git fetch failed:', (err as Error).message);
      return false;
    }

    let tag = '';
    try {
      tag = sh(`git -C "${root}" describe --tags --abbrev=0`, { encoding: 'utf8' }).trim();
    } catch { /* no tags yet, fall back to main */ }

    try {
      if (tag) {
        logger.info(`updating to release ${tag}...`);
        sh(`git -C "${root}" checkout ${tag}`, { stdio: 'inherit' });
        logger.info(`code updated to ${tag}`);
      } else {
        logger.info('no release tags found, pulling main...');
        sh(`git -C "${root}" pull origin main`, { stdio: 'inherit' });
        const commit = sh(`git -C "${root}" rev-parse --short HEAD`, { encoding: 'utf8' }).trim();
        logger.info('code updated to', commit || 'main');
      }
      return true;
    } catch (err) {
      logger.error('[UpdateCommand.updateRelease]', 'code update failed:', (err as Error).message);
      return false;
    }
  }

  async installDeps(root: string): Promise<boolean> {
    logger.debug('[UpdateCommand.installDeps]');
    logger.info('installing dependencies...');

    const frozen = existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'));
    try {
      sh(frozen ? 'bun install --frozen-lockfile' : 'bun install', { cwd: root, stdio: 'inherit' });
      logger.info('dependencies installed');
      return true;
    } catch (err) {
      logger.error('[UpdateCommand.installDeps]', 'dependency install failed:', (err as Error).message);
      return false;
    }
  }

  async restartService(root: string): Promise<boolean> {
    logger.debug('[UpdateCommand.restartService]');
    logger.info('updating service file...');

    try {
      const src = join(root, 'marvin.service');
      const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
      if (!existsSync(src)) {
        logger.error('[UpdateCommand.restartService]', 'service file missing:', src);
        return false;
      }
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      logger.info('service file updated:', dst);

      sh('systemctl --user daemon-reload', { stdio: 'inherit' });
      logger.info('restarting service...');
      sh('systemctl --user restart marvin', { stdio: 'inherit' });

      const active = await this.waitForActive();
      if (!active) return false;
      logger.info('service restarted');
      return true;
    } catch (err) {
      logger.error('[UpdateCommand.restartService]', 'service restart failed:', (err as Error).message);
      return false;
    }
  }

  // poll until the service settles, so a stuck "activating" fails the update
  async waitForActive(timeout = 15000): Promise<boolean> {
    logger.debug('[UpdateCommand.waitForActive]');

    for (let waited = 0; waited < timeout; waited += 1000) {
      let state = '';
      try {
        state = sh('systemctl --user is-active marvin', { encoding: 'utf8' }).trim();
      } catch (err) {
        state = ((err as { stdout?: string }).stdout || '').trim() || 'failed';
      }

      if (state === 'activating') {
        await delay(1000);
        continue;
      } else if (state === 'active') {
        logger.info('marvin service is:', state);
        return true;
      } else {
        logger.error('[UpdateCommand.waitForActive]', 'marvin service is stuck in state:', state, 'run "journalctl --user -u marvin -e" for details');
        return false;
      }
    }

    logger.error('[UpdateCommand.waitForActive]', 'marvin service still "activating" after', timeout, 'ms,', 'run "journalctl --user -u marvin -e" for details');
    return false;
  }
}
