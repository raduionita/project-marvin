import { Command } from "../types";

export default class ReloadCommand extends Command {
  async init() {
    console.debug('[marvin]', 'ReloadCommand.init');

    const url = new URL(`http://localhost:${this.ctx!.config.settings.port}/`);
    
    url.pathname = '/reload';

    if (!this.ctx.isDry) {
      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`ReloadCommand.init: Error ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } else {
      console.log('[marvin]', '[dry] would send reload to:', url.toString());
      return;
    }
  }
}
