import { Command } from "../types";

export default class HelpCommand extends Command {
  async load() {
    console.debug('[HelpCommand.load]');

    console.info('[HelpCommand.load]', 'usage: marvin [command] [options] [--flags]');
    console.info('[HelpCommand.load]', 'commands:');
    console.info('[HelpCommand.load]', '  help    ', 'show this help');
    console.info('[HelpCommand.load]', '  install ', 'install the project');
    console.info('[HelpCommand.load]', '  enable  ', 'load the project and service');
    console.info('[HelpCommand.load]', '  disable ', 'stop the app service');
    console.info('[HelpCommand.load]', '  serve   ', 'start the app service');
    console.info('[HelpCommand.load]', '  update  ', 'update Marvin to the latest version');
    console.info('[HelpCommand.load]', '  version ', 'show the current version');
    console.info('[HelpCommand.load]', '  reload  ', 'reload the daemon');
    console.info('[HelpCommand.load]', '  status  ', 'check the daemon status');
    console.info('[HelpCommand.load]', '  chat    ', 'send a chat message');
    console.info('[HelpCommand.load]', '  channels', 'list, load, bind, drop channels');
  }
}
