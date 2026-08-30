import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { Command } from "../types";
import logger from '../logger.js';

// `marvin reload` reloads the daemon
export default class ReloadCommand extends Command {
  async exec() {
    logger.debug('[ReloadCommand.exec]');

    // --logLevel (parsed by loadFlags in marvin.ts -> MARVIN_LOG_LEVEL) updates
    // ~/.marvin/.env so the systemd EnvironmentFile feeds it to the daemon
    const level = process.env.MARVIN_LOG_LEVEL;
    if (level) {
      this.setLogLevel(level.toLowerCase());
    }

    // restart (not reload): the unit has no ExecReload= and EnvironmentFile is
    // only re-read at process start, so reload cannot apply a new log level
    execSync(['systemctl', '--user', 'restart', 'marvin'].join(' '), { stdio: 'inherit' });

    logger.info('marvin service reloaded');
  }

  // set MARVIN_LOG_LEVEL in ~/.marvin/.env, keeping comments/other entries
  setLogLevel(level: string) {
    const envPath = join(this.engine.work, '.env');
    let content = '';
    if (existsSync(envPath)) {
      content = readFileSync(envPath, 'utf8');
    }

    const line = `MARVIN_LOG_LEVEL=${level}`;
    if (/^#?\s*MARVIN_LOG_LEVEL=/m.test(content)) {
      content = content.replace(/^#?\s*MARVIN_LOG_LEVEL=.*$/m, line);
    } else {
      content += (content.endsWith('\n') ? '' : '\n') + line + '\n';
    }

    writeFileSync(envPath, content);
    logger.info('MARVIN_LOG_LEVEL set to:', level, 'in', envPath);
  }
}
