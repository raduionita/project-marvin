import { Command } from "../types";

export default class HelpCommand extends Command {
  async init() {
    console.debug('[HelpCommand.init]');

    console.info('usage: marvin [command] [options]');
    console.info('commands:');
    console.info('  help    ', 'show this help');
    console.info('  init    ', 'initialize the project and service');
    console.info('  halt    ', 'stop the app service');
    console.info('  serve   ', 'start the app service');
    console.info('  update  ', 'update Marvin to the latest version');
    console.info('  version ', 'show the current version');
    console.info('  reload  ', 'reload the daemon');
    console.info('  status  ', 'check the daemon status');
    console.info('  chat    ', 'send a chat message');
    console.info('  channels', 'list, init, bind, drop channels');
  }
}
