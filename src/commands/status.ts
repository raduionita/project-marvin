import { execSync } from "node:child_process";
import { Command } from "../types";

// `marvin status [help]`
export default class StatusCommand extends Command {
  async exec() {
    this.logger.debug('[StatusCommand.exec]');

    const cmd = this.args[1];
    switch (cmd) {
      case 'help'   : 
        this.execHelp();
      break;
      default: 
        await this.execStatus();
      break;
    }
  }

  async execHelp() {
    this.logger.info('usage: marvin status [command]', 'check the daemon status');
    this.logger.info('commands:');
    this.logger.info('  help    ', 'show this help');
  }

  async execStatus() {
    this.logger.debug('[StatusCommand.execStatus]');
    // service status
    try {
      const status = execSync(['systemctl', '--user', 'status', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
      this.logger.info('service status:', status.trim());
    } catch {
      this.logger.info('service is not running.');
    }

    // TODO: replace health w/ GET status

    const port = this.engine!.config?.settings?.port || 7331;
    
    // health check
    try {
      const url = new URL(`http://localhost:${port}/_health`);
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.engine!.config.settings.apiToken}`,
        },
      });
      if (response.ok) {
        this.logger.info(`server is healthy (port ${port}).`);
      } else {
        this.logger.warn(`server responded with ${response.status}.`);
      }
    } catch (err) {
      this.logger.error('[StatusCommand.execStatus]', `cannot reach server at localhost:${port}.`);
    }
  }
}
