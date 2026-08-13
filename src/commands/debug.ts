import { Command } from "../types";

export default class DebugCommand extends Command {
  async exec() {
    this.logger.debug('[DebugCommand.exec]');

    await this.engine.load();
  }

  async drop() {
    this.logger.debug('[DebugCommand.drop]');

    await this.engine.drop();
  }
}
