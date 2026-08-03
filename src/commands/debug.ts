import { Command } from "../types";

export default class DebugCommand extends Command {
  async exec() {
    console.debug('[DebugCommand.exec]');

    await this.engine.load();
  }

  async drop() {
    console.debug('[DebugCommand.drop]');

    await this.engine.drop();
  }
}
