
import type Engine from '../engine.js';
import { Command } from '../types.js';

// `marvin serve [help] [--dry]`
export default class ServeCommand extends Command {
  constructor(engine: Engine, args: string[], deamon: boolean = true) {
    super(engine, args, deamon);
  }

  // load the app/server and its internal systems
  async exec() {
    console.debug('[ServeCommand.exec]');
    await this.engine.exec();
  }

  // will drop all the resources from the engine
  async drop() {
    console.debug('[ServeCommand.drop]', 'was', this.engine.state);
    await this.engine.drop();
  }
}
