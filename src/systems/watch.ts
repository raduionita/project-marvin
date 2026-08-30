import { FSWatcher, watch } from 'node:fs';
import { System } from '../types.js';
import { join } from 'node:path';
import ServeCommand from '../commands/serve.js';
import logger from '../logger.js';

export default class WatchSystem extends System {
  watchers: FSWatcher[] = [];

  async load(): Promise<void> {
    logger.debug('[WatchSystem.load]');

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
              logger.debug(`[WatchSystem.load]`, `eventType=${eventType} filename=${filename}`);
              break;
          }
        });
        watcher.on('error', this.handleError.bind(this));
        logger.debug(`[WatchSystem.load]`, `watching ${file}`);
        this.watchers.push(watcher);
      } catch (err) {
        logger.error('[WatchSystem.load]', 'error:', err);
      } 
    }
  }

  async drop(): Promise<void> {
    logger.debug('[WatchSystem.drop]');
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  handleChange(filename: string) {
    logger.debug(`[WatchSystem.handleChange]`, filename);
    this.engine.execReload();
  }

  handleError(err: Error) {
    logger.error('[WatchSystem.handleError]', err);
  }
}
