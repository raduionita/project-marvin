import { Command } from "../types";

export default class HelpCommand extends Command {
  async exec() {
    console.debug('[HelpCommand.exec]');

    console.info('[HelpCommand.exec]', 'usage: marvin [command] [options] [--flags]');
    console.info('[HelpCommand.exec]', 'commands:');
    console.info('[HelpCommand.exec]', '  help    ', 'show this help');
    console.info('[HelpCommand.exec]', '  install ', 'install the project');
    console.info('[HelpCommand.exec]', '  enable  ', 'load the project and service');
    console.info('[HelpCommand.exec]', '  disable ', 'stop the app service');
    console.info('[HelpCommand.exec]', '  serve   ', 'start the app service');
    console.info('[HelpCommand.exec]', '  tool    ', 'call a tool');
    console.info('[HelpCommand.exec]', '  update  ', 'update Marvin to the latest version');
    console.info('[HelpCommand.exec]', '  version ', 'show the current version');
    console.info('[HelpCommand.exec]', '  reload  ', 'reload the daemon');
    console.info('[HelpCommand.exec]', '  status  ', 'check the daemon status');
    console.info('[HelpCommand.exec]', '  chat    ', 'send a chat message');
    console.info('[HelpCommand.exec]', '  channels', 'list, add, bind, remove channels');
  }
}
