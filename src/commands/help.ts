import { Command } from "../types";

export default class HelpCommand extends Command {
  async init() {
    console.debug('[HelpCommand.init]');

    console.info('[HelpCommand.init]', 'usage: marvin [command] [options]');
    console.info('[HelpCommand.init]', 'commands:');
    console.info('[HelpCommand.init]', '  help    ', 'show this help');
    console.info('[HelpCommand.init]', '  init    ', 'initialize the project and service');
    console.info('[HelpCommand.init]', '  halt    ', 'stop the app service');
    console.info('[HelpCommand.init]', '  serve   ', 'start the app service');
    console.info('[HelpCommand.init]', '  update  ', 'update Marvin to the latest version');
    console.info('[HelpCommand.init]', '  version ', 'show the current version');
    console.info('[HelpCommand.init]', '  reload  ', 'reload the daemon');
    console.info('[HelpCommand.init]', '  status  ', 'check the daemon status');
    console.info('[HelpCommand.init]', '  chat    ', 'send a chat message');
    console.info('[HelpCommand.init]', '  channels', 'list, init, bind, drop channels');
  }
}
