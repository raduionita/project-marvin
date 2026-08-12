import { Command } from "../types";

export default class HelpCommand extends Command {
  async exec() {
    console.debug('[HelpCommand.exec]');

    console.info('usage: marvin [command] [options] [--dry] [--log-level=level]');
    console.info('commands:');
    console.info('  help    ', 'show this help');
    console.info('  install ', 'install the project');
    console.info('  enable  ', 'load the project and service');
    console.info('  disable ', 'stop the app service');
    console.info('  serve   ', 'start the app service');
    console.info('  tools   ', 'list, add, edit, call tools');
    console.info('  update  ', 'update Marvin to the latest version');
    console.info('  version ', 'show the current version');
    console.info('  reload  ', 'reload the daemon');
    console.info('  status  ', 'check the daemon status');
    console.info('  logs    ', 'tail the daemon log file [-f|--follow] [-n|--lines]');

    console.info('  agents  ', 'list, add, bind, chat, drop agents');
    console.info('  channels', 'list, add, bind, chat, drop channels');
    console.info('  integrations', 'list, add, drop integrations');
    console.info('  skills  ', 'list, add skills');
    console.info('  models  ', 'list, add, bind, drop models');
    console.info('  tasks   ', 'list, add tasks for an agent');
    console.log('');
  }
}
