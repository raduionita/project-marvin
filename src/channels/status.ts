import { execSync } from "node:child_process";
import { Command } from "../types";

export default class StatusChannel extends Command {
  async init() {
    console.debug('[marvin]', 'StatusChannel.init');

    const cmds = process.argv.slice(2);
    const cmd = cmds[1];

    switch (cmd) {
      case 'help'   : 
        console.debug('[marvin]', 'usage: marvin status [command]', 'check the daemon status');
        console.debug('[marvin]', 'commands:');
        console.debug('[marvin]', '  help    ', 'show this help');
      break;
      default: {
        // service status
        if (!this.ctx.isDry) {
          try {
            const status = execSync(['systemctl', '--user', 'status', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
            console.log('[marvin]', 'service status:', status.trim());
          } catch {
            console.log('[marvin] service is not running.');
          }
        } else {
          console.log('[marvin] [dry] would check systemd service status: marvin');
        }

        // TODO: replace health w/ GET status

        // health check
        const port = this.ctx!.config?.settings?.port || 7331;
        if (!this.ctx.isDry) {
          try {
            const url = new URL(`http://localhost:${port}/_health`);
            const response = await fetch(url.toString(), {
              method: 'GET',
              headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.ctx!.config.settings.apiToken}`,
              },
            });
            if (response.ok) {
              console.log('[marvin]', `server is healthy (port ${port}).`);
            } else {
              console.warn(`[marvin]`, `server responded with ${response.status}.`);
            }
          } catch (err) {
            console.error(`[marvin]`,`cannot reach server at localhost:${port}.`);
          }
        } else {
          console.log('[marvin] [dry] would check health endpoint: http://localhost:' + port + '/_health');
        } 
      } break;
    }
  }

  async drop() {
    console.debug('[marvin]', 'StatusChannel.drop');
  }
}
