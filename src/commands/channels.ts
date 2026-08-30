
import { join } from 'path';
import { writeFileSync } from 'fs';

import { input, password, select } from '../terminal';
import { Command, Message } from "../types";
import { listChannels, loadChannel } from '../channels';
import logger from '../logger.js';

// `marvin channels [command]` list, add, bind, chat, drop channels
export default class ChannelsCommand extends Command {
  async exec() {
    logger.debug('[ChannelsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default: 
        logger.warn('[ChannelsCommand.exec]', 'unknown command: channels', cmd); 
      case 'help'   : // default = empty = help 
        await this.execHelp();
      break;
      // list available channels, for each one, it's connected agents
      case 'list' : 
        await this.execList();
      break;
      // add a channel
      case 'add' : 
        await this.execAdd();
      break;
      // fetch channel info (e.g. slack groups) and cache it in marvin.json
      case 'info' : 
        await this.execInfo();
      break;
      // bind a channel:group to an agent
      case 'bind' :  break;
      // `marvin channels chat [channelId] [groupId]` // send message to channel
      case 'chat' :
        await this.execChat();
      break;
      // case 'drop' : break;
    }

    logger.debug('[ChannelsCommand.exec]', `done`);
  }

  // `marvin channels help`
  async execHelp() {
    logger.info('usage: marvin channels [command]');
    logger.info('commands:');
    logger.info('  help    ', 'show this help');
    logger.info('  list    ', 'list available channels, for each one, it\'s connected agents');
    logger.info('  add     ', 'add a channel');
    logger.info('  info [channelId]', 'fetch channel info (e.g. slack groups) and cache it in marvin.json');
    logger.info('  bind <agentId> <channelId> <groupId>', 'bind a channel to an agent');
    logger.info('  chat [channelId] [groupId]', 'send a message to a channel');
    logger.info('  drop <channelId>', 'drop a channel');
  }

  // `marvin channels list`
  async execList() {
    logger.debug('[ChannelsCommand.execList]');
    logger.info('list channels:');
    // for each channel, list enabled agents
    listChannels(this.engine).forEach(channel => {
      logger.info(`  ${channel}`);
      const channelConfig = this.engine.config.channels[channel];
      if (channelConfig) {
        logger.info('  - enabled:', channelConfig.enabled);
      }
      logger.info('  - agents:');
      for (const [agentId, agent] of Object.entries(this.engine.config.agents)) {
        if (!agent.enabled) continue;
        if (!agent.channels[channel]) continue;
        logger.info('    -', agentId, ':', `@${agent.channels[channel]}`);
      }
    });
  }

  // `marvin channels add [channelId]`
  async execAdd() {
    logger.info('[ChannelsCommand.execAdd]', 'adding a channel...');

    const channels = listChannels(this.engine);

    logger.log('');

    // ask for channelId
    const channelId = this.args[1] || await select({
      message: 'Select channel:',
      choices: channels.map(id => ({ name: id, value: id })),
    });
    
    if (!channels.includes(channelId)) {
      logger.error('[ChannelsCommand.execAdd]', `unknown channel "${channelId}"`);
      logger.error('[ChannelsCommand.execAdd]', 'available channels:', channels.join(', '));
      return;
    }

    // check if channel is already loaded
    if (this.engine.config.channels[channelId]) {
      logger.warn('[ChannelsCommand.execAdd]', `channel "${channelId}" is already loaded`);
      return;
    }

    const channel = await loadChannel(this.engine, channelId);
    if (!channel) {
      logger.error('[ChannelsCommand.execAdd]', `channel "${channelId}" not found`);
      return;
    }

    const config: Record<string, string> = {};

    // ask for arguments (for each arg in args, ask for value)
    for (const [arg, placeholder] of Object.entries(channel.meta.arguments)) {
      const message = `Enter ${channelId} ${arg} (e.g. ${placeholder}):`;
      config[arg] = /token|secret|key|password/i.test(arg)
        ? await password({ message })
        : await input({ message });
    }

    logger.log('');

    // register the channel in config
    this.engine.config.channels[channelId] = { enabled: true, ...config };

    // run load to see if the channel works
    await channel.load();
    await channel.drop();

    // channel works - persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');

    // write to config file
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    
    logger.info('[ChannelsCommand.execAdd]', `channel "${channelId}" configured, config persisted to ${cpath}`);
  }

  // `marvin channels info [channelId]` // fetch channel info (e.g. slack groups) and cache it in marvin.json
  async execInfo() {
    logger.info('[ChannelsCommand.execInfo]', 'fetching channel info...');

    logger.log('');

    // ask for channelId
    const channelId = this.args[1] || await select({
      message: 'Select channel:',
      choices: listChannels(this.engine).map(id => ({ name: id, value: id })),
    });

    // the channel must be configured (tokens etc.) to connect
    if (!this.engine.config.channels[channelId]) {
      logger.error('[ChannelsCommand.execInfo]', `channel "${channelId}" not configured, run "marvin channels add ${channelId}" first`);
      return;
    }

    const channel = await loadChannel(this.engine, channelId);
    if (!channel) {
      logger.error('[ChannelsCommand.execInfo]', `channel "${channelId}" not found`);
      return;
    }

    await channel.load();
    const info = await channel.info();
    await channel.drop();

    // merge the groups into the channel config (top level)
    this.engine.config.channels[channelId] = { ...this.engine.config.channels[channelId], groups: info.groups || {} };

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

    // display the cached info from config
    const groups = this.engine.config.channels[channelId].groups || {};
    logger.info(`channel "${channelId}" info (cached in ${cpath}):`);
    logger.info(' ID        ', '|', 'Name');
    logger.info('-----------', '|', '----');
    for (const [id, name] of Object.entries(groups)) {
      logger.info(`${id}`, '|', `${name}`);
    }
  }

  // `marvin channels bind [agentId] [channelId] [groupId]`
  async execBind() {
    logger.info('[ChannelsCommand.execBind]', 'binding a channel:group to an agent...');

    logger.log('');
    // ask for agentId
    const agentId = this.args[1] || await select({
      message: 'Enter agent (e.g. my-agent):',
      choices: Object.keys(this.engine.config.agents).map(id => ({ name: id, value: id })),
    });
    // ask for channelId
    const channelId = this.args[2] || await select({
      message: 'Enter channel (e.g. slack):',
      choices: listChannels(this.engine).map(id => ({ name: id, value: id })),
    });
    // ask for groupId
    const groupId = this.args[3] || await input({ message: 'Enter group (optional, e.g. general):' });

    if (!channelId || !agentId) {
      logger.warn('[ChannelsCommand.execBind]', 'invalid inputs, exiting');
      return;
    }

    // validate channel exists
    if (!this.engine.config.channels[channelId]) {
      logger.error('[ChannelsCommand.execBind]', `channel "${channelId}" not found in config`);
      return;
    }

    // validate agent exists
    if (!this.engine.config.agents[agentId]) {
      logger.error('[ChannelsCommand.execBind]', `agent "${agentId}" not found in config`);
      logger.error('[ChannelsCommand.execBind]', 'available agents:', Object.keys(this.engine.config.agents).join(', '));
      return;
    }

    // add the binding (overwrites if already bound to this channel)
    this.engine.config.agents[agentId].channels = this.engine.config.agents[agentId].channels || {};
    this.engine.config.agents[agentId].channels[channelId] = groupId; 

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

    logger.info('[ChannelsCommand.execBind]', `agent "${agentId}" bound to channel "${channelId}:${groupId}", config persisted to ${cpath}`);
  }

  // `marvin channels chat [channelId] [groupId]`
  async execChat() {
    logger.info('[ChannelsCommand.execChat]', 'sending a message to a channel...');
    
    logger.log('');
    
    // ask for channelId
    let channelId = this.args[1] || await select({
      message: 'Enter channel (e.g. slack):',
      choices: listChannels(this.engine).map(id => ({ name: id, value: id })),
    });
    const channel = await loadChannel(this.engine, channelId);
    if (!channel) {
      logger.error('[ChannelsCommand.execChat]', `channel "${channelId}" not found`);
      return;
    }

    await channel.load();

    // list available groups as a table
    const info = await channel.info();
    const groups = info.groups || {};
    logger.info(' ID        ', '|', 'Name');
    logger.info('-----------', '|' ,'----');
    for (const [id, name] of Object.entries(groups)) {
      logger.info(`${id}`, '|', `${name}`);
    }
    logger.log('');

    // ask for groupId
    let groupId = this.args[2] || (Object.keys(groups).length
      ? await select({
          message: 'Enter group (e.g. general):',
          choices: Object.entries(groups).map(([id, name]) => ({ name, value: id })),
        })
      : '');

    // find groupId in groups
    for (const [id, name] of Object.entries(groups)) {
      if (name === groupId || id === groupId) {
        groupId = id;
        break;
      }
    }

    if (!groupId) {
      logger.warn('[ChannelsCommand.execChat]', 'invalid groupId, exiting');
      return;
    }

    // ask for message
    const message = await input({ message: 'Message:' });

    logger.log('');

    const result = await channel.sendMessage({ role: 'assistant', content: message, group: groupId } as Message);
    if (!result.ok) {
      logger.error('[ChannelsCommand.execChat]', `channel "${channelId}" send failed:`, result.error);
      return;
    }

    await channel.drop();

    logger.info(`${channelId}:${groupId}: ${message}`);
  }
}
