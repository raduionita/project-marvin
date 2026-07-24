import { execSync } from "child_process";
import { Command } from "../types";

export default class ReloadCommand extends Command {
  async load() {
    console.debug('[ReloadCommand.load]');

    // const url = new URL(`http://localhost:${this.ctx!.config.settings.port}/`);
    // url.pathname = '/reload';

    if (this.ctx.isDry) {
      console.log('[ReloadCommand.load]', '[dry]', 'repload service:', ['systemctl', '--user', 'reload', 'marvin'].join(' '));
    } else {
      // const res = await fetch(url.toString());
      // if (!res.ok) {
        // throw new Error(`ReloadCommand.load: Error ${res.status} ${res.statusText}`);
      // }
      // return await res.json();

      execSync(['systemctl', '--user', 'reload', 'marvin'].join(' '), { stdio: 'inherit' });
    }
  }
}
