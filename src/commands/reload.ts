import { execSync } from "child_process";
import { Command } from "../types";

export default class ReloadCommand extends Command {
  async init() {
    console.debug('[ReloadCommand.init]');

    // const url = new URL(`http://localhost:${this.ctx!.config.settings.port}/`);
    // url.pathname = '/reload';

    if (this.ctx.isDry) {
      console.log('[dry] repload service:', ['systemctl', '--user', 'reload', 'marvin'].join(' '));
    } else {
      // const res = await fetch(url.toString());
      // if (!res.ok) {
        // throw new Error(`ReloadCommand.init: Error ${res.status} ${res.statusText}`);
      // }
      // return await res.json();

      const output = execSync(['systemctl', '--user', 'reload', 'marvin'].join(' '), { stdio: 'inherit' });
      console.log('[marvin] reloaded service:', output.toString());
    }
  }
}
