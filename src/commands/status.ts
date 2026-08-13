import { execSync } from "node:child_process";
import { Command } from "../types";

// `marvin status [help] [--dry]`
export default class StatusCommand extends Command {
  async exec() {
    this.logger.debug('[StatusCommand.exec]');

    const cmd = this.args[1];
    switch (cmd) {
      case 'help'   : 
        this.logger.info('usage: marvin status [command]', 'check the daemon status');
        this.logger.info('commands:');
        this.logger.info('  help    ', 'show this help');
      break;
      default: {
        // service status
        if (this.engine.isDry) {
          this.logger.info('[dry]','check status:', ['systemctl', '--user', 'status', 'marvin'].join(' '));
        } else {
          try {
            const status = execSync(['systemctl', '--user', 'status', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
            this.logger.info('service status:', status.trim());
          } catch {
            this.logger.info('service is not running.');
          }
        }

        // TODO: replace health w/ GET status

        const port = this.engine!.config?.settings?.port || 7331;
        
        // health check
        if (this.engine.isDry) {
          this.logger.info('[dry]', 'check health: fetch http://localhost:' + port + '/_health');
        } else {
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
            this.logger.error('[StatusCommand.exec]', `cannot reach server at localhost:${port}.`);
          }
        } 
      } break;
    }
  }
}
