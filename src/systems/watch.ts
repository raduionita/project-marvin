import { FSWatcher, watch } from 'node:fs';
import { System } from '../types.js';
import { join } from 'node:path';
import ServeCommand from '../commands/serve.js';

export default class WatchSystem extends System {
  watchers: FSWatcher[] = [];

  async load(): Promise<void> {
    console.debug('[WatchSystem.load]');
    const files = [
      join(this.ctx.home, 'marvin.json'),
    ] as string[];

    for (const file of files) {
      if (this.ctx.isDry) {
        console.info('[WatchSystem.load]', '[dry]', file);
        continue;
      }

      try {
        const watcher = watch(file, (eventType, filename) => {
          switch (eventType) {
            case 'change':
              this.handleChange(filename!);
            break;
            default:
              console.debug(`[WatchSystem.load]`, `eventType=${eventType} filename=${filename}`);
              break;
          }
        });
        watcher.on('error', this.handleError.bind(this));
        console.debug(`[WatchSystem.load]`, `watching ${file}`);
        this.watchers.push(watcher);
      } catch (err) {
        console.error('[WatchSystem.load]', 'error:', err);
      }
    }

  }
  
  async drop(): Promise<void> {
    console.debug('[WatchSystem.drop]');
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  handleChange(filename: string) {
    console.debug(`[WatchSystem.handleChange]`, filename);
    const serve = this.ctx.command as ServeCommand;
    if (!serve) {
      console.error('[WatchSystem.handleChange]', 'serve command not found');
      return;
    }
    serve.execReload();
  }

  handleError(err: Error) {
    console.error('[WatchSystem.handleError]', err);
  }
}
