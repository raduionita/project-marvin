import { Command } from "../types";
import logger from '../logger.js';

export default class HelpCommand extends Command {
  async exec() {
    logger.debug('[HelpCommand.exec]');

    logger.info('usage: marvin [command] [options] [--log-level=level]');
    logger.info('commands:');
    logger.info('  help    ', 'show this help');
    logger.info('  install ', 'install the project');
    logger.info('  enable  ', 'load the project and service');
    logger.info('  disable ', 'stop the app service');
    logger.info('  serve   ', 'start the app service');
    logger.info('  tools   ', 'list, add, edit, call tools');
    logger.info('  update  ', 'update Marvin to the latest version');
    logger.info('  version ', 'show the current version');
    logger.info('  reload  ', 'reload the daemon');
    logger.info('  status  ', 'check the daemon status');
    logger.info('  logs    ', 'tail the daemon log file [-f|--follow] [-n|--lines]');

    logger.info('  agents  ', 'list, add, bind, chat, drop agents');
    logger.info('  channels', 'list, add, bind, chat, drop channels');
    logger.info('  integrations', 'list, add, drop integrations');
    logger.info('  mcps    ', 'list, add, edit, info, drop mcp connectors');
    logger.info('  skills  ', 'list, add skills');
    logger.info('  models  ', 'list, add, bind, drop models');
    logger.info('  tasks   ', 'list, add tasks');
    logger.log('');
  }
}
