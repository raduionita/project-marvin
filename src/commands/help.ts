import { Command } from "../types";
import logger from '../logger.js';

export default class HelpCommand extends Command {
  async exec() {
    logger.debug('[HelpCommand.exec]');

    logger.log('');
    logger.log('usage: marvin [command] [options] [--log-level=level]');
    logger.log('commands:');
    logger.log('  help    ', 'show this help');
    logger.log('  install ', 'install the project');
    logger.log('  enable  ', 'load the project and service');
    logger.log('  disable ', 'stop the app service');
    logger.log('  serve   ', 'start the app service');
    logger.log('  tools   ', 'list, add, edit, call tools');
    logger.log('  update  ', 'update Marvin to the latest version');
    logger.log('  skills  ', 'list, add skills');
    logger.log('  version ', 'show the current version');
    logger.log('  reload  ', 'reload the daemon');
    logger.log('  status  ', 'check the daemon status');
    logger.log('  logs    ', 'tail the daemon log file [-f|--follow] [-n|--lines]');
    logger.log('');
    logger.log('  channels    ', 'list, add, bind, chat, drop channels');
    logger.log('  models      ', 'list, add, bind, drop models');
    logger.log('  agents      ', 'list, add, bind, chat, drop agents');
    logger.log('  tasks       ', 'list, add tasks');
    logger.log('  mcps        ', 'list, add, edit, info, drop mcp connectors');
    logger.log('');
  }
}
