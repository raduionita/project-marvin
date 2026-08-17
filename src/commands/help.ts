import { Command } from "../types";

export default class HelpCommand extends Command {
  async exec() {
    this.logger.debug('[HelpCommand.exec]');

    this.logger.info('usage: marvin [command] [options] [--dry] [--log-level=level]');
    this.logger.info('commands:');
    this.logger.info('  help    ', 'show this help');
    this.logger.info('  install ', 'install the project');
    this.logger.info('  enable  ', 'load the project and service');
    this.logger.info('  disable ', 'stop the app service');
    this.logger.info('  serve   ', 'start the app service');
    this.logger.info('  tools   ', 'list, add, edit, call tools');
    this.logger.info('  update  ', 'update Marvin to the latest version');
    this.logger.info('  version ', 'show the current version');
    this.logger.info('  reload  ', 'reload the daemon');
    this.logger.info('  status  ', 'check the daemon status');
    this.logger.info('  logs    ', 'tail the daemon log file [-f|--follow] [-n|--lines]');

    this.logger.info('  agents  ', 'list, add, bind, chat, drop agents');
    this.logger.info('  channels', 'list, add, bind, chat, drop channels');
    this.logger.info('  integrations', 'list, add, drop integrations');
    this.logger.info('  skills  ', 'list, add skills');
    this.logger.info('  models  ', 'list, add, bind, drop models');
    this.logger.info('  tasks   ', 'list, add tasks');
    this.logger.log('');
  }
}
