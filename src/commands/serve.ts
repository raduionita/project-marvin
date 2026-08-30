
import type Engine from '../engine.js';
import { Command } from '../types.js';
import { setLoggerMode } from '../logger.js';
import logger from '../logger.js';

// `marvin serve [help]`
export default class ServeCommand extends Command {
  constructor(engine: Engine, args: string[], deamon: boolean = true) {
    super(engine, args, deamon);
  }

  // load the app/server and its internal systems
  async exec() {
    // daemon output: prefix every line with [LEVEL] and keep [ClassName.method]
    // tags, so marvin.log reads e.g. `[INFO] [SlackChannel.onConnected] connected!`
    setLoggerMode({ prefix: true, stripTags: false });
    logger.debug('[ServeCommand.exec]');
    await this.engine.exec();
  }

  // will drop all the resources from the engine
  async drop() {
    logger.debug('[ServeCommand.drop]', 'was', this.engine.state);
    await this.engine.drop();
  }
}
