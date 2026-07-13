import { Command } from "../types";

export default class HelpCommand extends Command {
  async init() {
    console.debug('[marvin]', 'HelpCommand.init');

    console.info('[marvin]', 'usage: marvin [command] [options]');
    console.info('[marvin]', 'commands:');
    console.info('[marvin]', '  help    ', 'show this help');
    console.info('[marvin]', '  setup   ', 'setup the project and service');
    console.info('[marvin]', '  update  ', 'update Marvin to the latest version');
    console.info('[marvin]', '  version ', 'show the current version');
    console.info('[marvin]', '  reload  ', 'reload the daemon');
    console.info('[marvin]', '  status  ', 'check the daemon status');
    console.info('[marvin]', '  chat    ', 'send a chat message');
    console.info('[marvin]', '  channels', 'list, init, bind, drop channels');
  }
}
