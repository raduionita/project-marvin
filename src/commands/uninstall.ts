import { homedir } from 'os';
import { join, resolve, sep } from 'path';
import { existsSync, lstatSync, rmSync } from 'fs';
import { Command } from '../types';
import { confirm, sh } from '../terminal.js';
import logger from '../logger.js';

// `marvin uninstall` stops the service and removes every artifact install.sh
// and `marvin enable` create: systemd unit, wrapper, project dir, workspace.
// `marvin uninstall --keep-config` keeps the workspace (~/.marvin).
// `marvin uninstall --yes` skips the confirmation prompt.
export default class UninstallCommand extends Command {
  async exec() {
    logger.debug('[UninstallCommand.exec]');

    const cmd = this.args[0] || '';
    switch (cmd) {
      case 'help':
        this.execHelp();
      break;
      case '':
        await this.execUninstall();
      break;
      default:
        // flags double as the default action: `marvin uninstall --yes`
        if (cmd.startsWith('-')) {
          await this.execUninstall();
          break;
        }
        logger.error('[UninstallCommand.exec]', `unknown command: ${cmd}`);
        this.execHelp();
      break;
    }
  }

  execHelp() {
    logger.info('usage: marvin uninstall [--keep-config] [--yes|--force]');
    logger.info('commands:');
    logger.info('  help  ', 'show this help');
    logger.info('        ', 'stop the service and remove project + workspace folders');
    logger.info('options:');
    logger.info('  --keep-config  ', 'keep the workspace (~/.marvin)');
    logger.info('  --yes, -y      ', 'skip the confirmation prompt');
    logger.info('  --force        ', 'also remove the project dir when it is a git checkout');
  }

  parseFlags(): { keepConfig: boolean; assumeYes: boolean; force: boolean } {
    return {
      keepConfig: this.args.includes('--keep-config'),
      assumeYes: this.args.includes('--yes') || this.args.includes('-y') || this.args.includes('--force'),
      force: this.args.includes('--force'),
    };
  }

  async execUninstall() {
    logger.debug('[UninstallCommand.execUninstall]');

    const { keepConfig, assumeYes, force } = this.parseFlags();
    const root = this.engine.root;
    const work = this.engine.work;
    const unit = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    const wrapper = join(homedir(), '.local', 'bin', 'marvin');

    if (!assumeYes) {
      const ok = await confirm({
        message: `Remove marvin? (service, ${root}, ${keepConfig ? 'keep' : 'remove'} ${work})`,
        default: false,
      });
      if (!ok) {
        logger.info('aborted, nothing removed');
        return;
      }
    }

    await this.stopService();
    await this.removeUnit(unit);
    await this.removeWrapper(wrapper);
    await this.removeProject(root, force);
    if (keepConfig) {
      logger.info('keeping workspace:', work);
    } else {
      await this.removeWorkspace(work);
    }

    logger.info('marvin uninstalled');
  }

  async stopService() {
    logger.debug('[UninstallCommand.stopService]');
    logger.info('stopping service...');

    try {
      sh('systemctl --user stop marvin', { stdio: 'inherit' });
      sh('systemctl --user disable marvin', { stdio: 'inherit' });
    } catch {
      logger.warn('[UninstallCommand.stopService]', 'stop/disable failed, service may already be inactive');
    }

    try {
      const state = sh('systemctl --user is-active marvin', { encoding: 'utf8' }).trim();
      logger.info('service is:', state);
    } catch {
      logger.info('service stopped: inactive');
    }
  }

  async removeUnit(unit: string) {
    logger.debug('[UninstallCommand.removeUnit]');
    logger.info('removing service file...');

    if (!this.removePath(unit, 'service file')) return;
    try {
      sh('systemctl --user daemon-reload', { stdio: 'inherit' });
      logger.info('systemd reloaded');
    } catch (err) {
      logger.warn('[UninstallCommand.removeUnit]', 'daemon-reload failed:', (err as Error).message);
    }
  }

  async removeWrapper(wrapper: string) {
    logger.debug('[UninstallCommand.removeWrapper]');
    logger.info('removing wrapper...');

    this.removePath(wrapper, 'wrapper');

    // legacy symlink from older installs (uninstall.sh); never touch a real file there
    const legacy = '/usr/local/bin/marvin';
    try {
      if (lstatSync(legacy).isSymbolicLink()) {
        rmSync(legacy, { force: true });
        logger.info('legacy symlink removed:', legacy);
      } else if (existsSync(legacy)) {
        logger.warn('[UninstallCommand.removeWrapper]', `${legacy} is not a symlink, skipping`);
      }
    } catch { /* missing, already removed */ }
  }

  async removeProject(root: string, force: boolean) {
    logger.debug('[UninstallCommand.removeProject]');
    logger.info('removing project dir...');

    if (existsSync(join(root, '.git')) && !force) {
      logger.warn('[UninstallCommand.removeProject]', 'project dir is a git checkout, skipping (re-run with --force to remove):', root);
      return;
    }
    this.removePath(root, 'project dir');
  }

  async removeWorkspace(work: string) {
    logger.debug('[UninstallCommand.removeWorkspace]');
    logger.info('removing workspace...');
    this.removePath(work, 'workspace');
  }

  // only delete paths inside $HOME (never $HOME itself, / or elsewhere)
  isSafeToRemove(p: string): boolean {
    if (!p) return false;
    const home = homedir();
    const norm = resolve(p);
    if (norm === sep || norm === home) return false;
    return norm.startsWith(home + sep);
  }

  // rm -rf with per-step feedback; true when gone (or already gone)
  removePath(p: string, label: string): boolean {
    if (!existsSync(p)) {
      try {
        // existsSync is false for broken symlinks too, still try to unlink
        if (lstatSync(p).isSymbolicLink()) {
          rmSync(p, { force: true });
          logger.info(`${label} removed:`, p);
        } else {
          logger.info(`${label} not found (already removed):`, p);
        }
      } catch {
        logger.info(`${label} not found (already removed):`, p);
      }
      return true;
    }
    if (!this.isSafeToRemove(p)) {
      logger.error('[UninstallCommand.removePath]', `refusing to remove ${label} outside $HOME:`, p);
      return false;
    }
    try {
      rmSync(p, { recursive: true, force: true });
      logger.info(`${label} removed:`, p);
      return true;
    } catch (err) {
      logger.error('[UninstallCommand.removePath]', `failed to remove ${label}:`, p, (err as Error).message);
      return false;
    }
  }
}
