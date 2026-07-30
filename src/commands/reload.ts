import { execSync } from "child_process";
import { Command } from "../types";

export default class ReloadCommand extends Command {
  async exec() {
    console.debug('[ReloadCommand.exec]');

    // const url = new URL(`http://localhost:${this.ctx!.config.settings.port}/`);
    // url.pathname = '/reload';

    if (this.engine.isDry) {
      console.info('[ReloadCommand.exec]', '[dry]', 'repload service:', ['systemctl', '--user', 'reload', 'marvin'].join(' '));
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
