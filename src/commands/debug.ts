import { Command } from "../types";
import logger from '../logger.js';

export default class DebugCommand extends Command {
  async exec() {
    logger.debug('[DebugCommand.exec]');

    // await this.engine.load();
  }

  async drop() {
    logger.debug('[DebugCommand.drop]');

    // await this.engine.drop();
  }
}
