import { FSWatcher, watch } from 'node:fs';
import { System } from '../types.js';
import { join } from 'node:path';
import ServeCommand from '../commands/serve.js';

export default class WatchSystem extends System {
  watchers: FSWatcher[] = [];

  async load(): Promise<void> {
    console.debug('[WatchSystem.load]');
  }

  async drop(): Promise<void> {
    console.debug('[WatchSystem.drop]');
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  addFile(file: string) {
    console.debug(`[WatchSystem.addFile]`, file);
    try {
      const watcher = watch(file, (eventType, filename) => {
        switch (eventType) {
          case 'change':
            this.handleChange(filename!);
            break;
          default:
            console.debug(`[WatchSystem.addFile]`, `eventType=${eventType} filename=${filename}`);
            break;
        }
      });
      watcher.on('error', this.handleError.bind(this));
      console.debug(`[WatchSystem.addFile]`, `watching ${file}`);
      this.watchers.push(watcher);
    } catch (err) {
      console.error('[WatchSystem.addFile]', 'error:', err);
    }
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
