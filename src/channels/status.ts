import { execSync } from "node:child_process";
import { Command } from "../types";

export default class StatusCommand extends Command {
  async load() {
    console.debug('[StatusCommand.load]');

    const cmds = process.argv.slice(2);
    const cmd = cmds[1];

    switch (cmd) {
      case 'help'   : 
        console.debug('[StatusCommand.load]', 'usage: marvin status [command]', 'check the daemon status');
        console.debug('[StatusCommand.load]', 'commands:');
        console.debug('[StatusCommand.load]', '  help    ', 'show this help');
      break;
      default: {
        // service status
        if (this.ctx.isDry) {
          console.log('[StatusCommand.load]', '[dry]','check status:', ['systemctl', '--user', 'status', 'marvin'].join(' '));
        } else {
          try {
            const status = execSync(['systemctl', '--user', 'status', 'marvin'].join(' '), { encoding: 'utf8' }).trim();
            console.log('[StatusCommand.load]', 'service status:', status.trim());
          } catch {
            console.log('[StatusCommand.load]', 'service is not running.');
          }
        }

        // TODO: replace health w/ GET status

        const port = this.ctx!.config?.settings?.port || 7331;
        
        // health check
        if (this.ctx.isDry) {
          console.log('[StatusCommand.load]', '[dry]', 'check health: fetch http://localhost:' + port + '/_health');
        } else {
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
              console.log('[StatusCommand.load]', `server is healthy (port ${port}).`);
            } else {
              console.warn('[StatusCommand.load]', `server responded with ${response.status}.`);
            }
          } catch (err) {
            console.error('[StatusCommand.load]', `cannot reach server at localhost:${port}.`);
          }
        } 
      } break;
    }
  }
}
