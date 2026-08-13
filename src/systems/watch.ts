import { FSWatcher, watch } from 'node:fs';
import { System } from '../types.js';
import { join } from 'node:path';
import ServeCommand from '../commands/serve.js';

export default class WatchSystem extends System {
  watchers: FSWatcher[] = [];

  async load(): Promise<void> {
    this.logger.debug('[WatchSystem.load]');

    const files = [
      join(this.engine.work, 'marvin.json'),
    ]
    for (const file of files) {
      try {
        const watcher = watch(file, (eventType, filename) => {
          switch (eventType) {
            case 'change':
              this.handleChange(filename!);
              break;
            default:
              this.logger.debug(`[WatchSystem.load]`, `eventType=${eventType} filename=${filename}`);
              break;
          }
        });
        watcher.on('error', this.handleError.bind(this));
        this.logger.debug(`[WatchSystem.load]`, `watching ${file}`);
        this.watchers.push(watcher);
      } catch (err) {
        this.logger.error('[WatchSystem.load]', 'error:', err);
      } 
    }
  }

  async drop(): Promise<void> {
    this.logger.debug('[WatchSystem.drop]');
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  handleChange(filename: string) {
    this.logger.debug(`[WatchSystem.handleChange]`, filename);
    this.engine.execReload();
  }

  handleError(err: Error) {
    this.logger.error('[WatchSystem.handleError]', err);
  }
}
