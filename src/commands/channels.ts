
import { input, password, select } from '@inquirer/prompts';
import { join } from 'path';
import { writeFileSync } from 'fs';

import { Command, Message } from "../types";
import { listChannels, loadChannel } from '../channels';

// `marvin channels [command] [--dry]` list, add, bind, chat, drop channels
export default class ChannelsCommand extends Command {
  async exec() {
    this.logger.debug('[ChannelsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default: 
        this.logger.warn('[ChannelsCommand.exec]', 'unknown command: channels', cmd); 
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

    this.logger.debug('[ChannelsCommand.exec]', `done`);
  }

  // `marvin channels help`
  async execHelp() {
    this.logger.info('usage: marvin channels [command]');
    this.logger.info('commands:');
    this.logger.info('  help    ', 'show this help');
    this.logger.info('  list    ', 'list available channels, for each one, it\'s connected agents');
    this.logger.info('  add     ', 'add a channel');
    this.logger.info('  info [channelId]', 'fetch channel info (e.g. slack groups) and cache it in marvin.json');
    this.logger.info('  bind <agentId> <channelId> <groupId>', 'bind a channel to an agent');
    this.logger.info('  chat [channelId] [groupId]', 'send a message to a channel');
    this.logger.info('  drop <channelId>', 'drop a channel');
  }

  // `marvin channels list`
  async execList() {
    this.logger.debug('[ChannelsCommand.execList]');
    this.logger.info('list channels:');
    // for each channel, list enabled agents
    listChannels(this.engine).forEach(channel => {
      this.logger.info(`  ${channel}`);
      const channelConfig = this.engine.config.channels[channel];
      if (channelConfig) {
        this.logger.info('  - enabled:', channelConfig.enabled);
      }
      this.logger.info('  - agents:');
      for (const [agentId, agent] of Object.entries(this.engine.config.agents)) {
        if (!agent.enabled) continue;
        if (!agent.channels[channel]) continue;
        this.logger.info('    -', agentId, ':', `@${agent.channels[channel]}`);
      }
    });
  }

  // `marvin channels add [channelId]`
  async execAdd() {
    this.logger.info('[ChannelsCommand.execAdd]', 'adding a channel...');

    const channels = listChannels(this.engine);

    this.logger.log('');

    // ask for channelId
    const channelId = this.args[1] || await select({
      message: 'Select channel:',
      choices: channels.map(id => ({ name: id, value: id })),
    });
    
    if (!channels.includes(channelId)) {
      this.logger.error('[ChannelsCommand.execAdd]', `unknown channel "${channelId}"`);
      this.logger.error('[ChannelsCommand.execAdd]', 'available channels:', channels.join(', '));
      return;
    }

    // check if channel is already loaded
    if (this.engine.config.channels[channelId]) {
      this.logger.warn('[ChannelsCommand.execAdd]', `channel "${channelId}" is already loaded`);
      return;
    }

    const channel = await loadChannel(this.engine, channelId);
    if (!channel) {
      this.logger.error('[ChannelsCommand.execAdd]', `channel "${channelId}" not found`);
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

    this.logger.log('');

    // register the channel in config
    this.engine.config.channels[channelId] = { enabled: true, ...config };

    // run load to see if the channel works
    await channel.load();
    await channel.drop();

    // channel works - persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');

    // write to config file
    if (this.engine.isDry) {
      this.logger.info('[ChannelsCommand.execAdd]', '[dry]',`would configure channel ${channelId}, config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }
    
    this.logger.info('[ChannelsCommand.execAdd]', `channel "${channelId}" configured, config persisted to ${cpath}`);
  }

  // `marvin channels info [channelId]` // fetch channel info (e.g. slack groups) and cache it in marvin.json
  async execInfo() {
    this.logger.info('[ChannelsCommand.execInfo]', 'fetching channel info...');

    this.logger.log('');

    // ask for channelId
    const channelId = this.args[1] || await select({
      message: 'Select channel:',
      choices: listChannels(this.engine).map(id => ({ name: id, value: id })),
    });

    // the channel must be configured (tokens etc.) to connect
    if (!this.engine.config.channels[channelId]) {
      this.logger.error('[ChannelsCommand.execInfo]', `channel "${channelId}" not configured, run "marvin channels add ${channelId}" first`);
      return;
    }

    const channel = await loadChannel(this.engine, channelId);
    if (!channel) {
      this.logger.error('[ChannelsCommand.execInfo]', `channel "${channelId}" not found`);
      return;
    }

    await channel.load();
    const info = await channel.info();
    await channel.drop();

    // merge the groups into the channel config (top level)
    this.engine.config.channels[channelId] = { ...this.engine.config.channels[channelId], groups: info.groups || {} };

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      this.logger.info('[ChannelsCommand.execInfo]', '[dry]', `would cache channel info for ${channelId}, config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    // display the cached info from config
    const groups = this.engine.config.channels[channelId].groups || {};
    this.logger.info(`channel "${channelId}" info (cached in ${cpath}):`);
    this.logger.info(' ID        ', '|', 'Name');
    this.logger.info('-----------', '|', '----');
    for (const [id, name] of Object.entries(groups)) {
      this.logger.info(`${id}`, '|', `${name}`);
    }
  }

  // `marvin channels bind [agentId] [channelId] [groupId]`
  async execBind() {
    this.logger.info('[ChannelsCommand.execBind]', 'binding a channel:group to an agent...');

    this.logger.log('');
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
      this.logger.warn('[ChannelsCommand.execBind]', 'invalid inputs, exiting');
      return;
    }

    // validate channel exists
    if (!this.engine.config.channels[channelId]) {
      this.logger.error('[ChannelsCommand.execBind]', `channel "${channelId}" not found in config`);
      return;
    }

    // validate agent exists
    if (!this.engine.config.agents[agentId]) {
      this.logger.error('[ChannelsCommand.execBind]', `agent "${agentId}" not found in config`);
      this.logger.error('[ChannelsCommand.execBind]', 'available agents:', Object.keys(this.engine.config.agents).join(', '));
      return;
    }

    if (this.engine.isDry) {
      this.logger.info('[ChannelsCommand.execBind]', '[dry]', `would bind channel ${channelId}:${groupId} to agent ${agentId}`);
    } else {
      // add the binding (overwrites if already bound to this channel)
      this.engine.config.agents[agentId].channels = this.engine.config.agents[agentId].channels || {};
      this.engine.config.agents[agentId].channels[channelId] = groupId; 

      // persist to marvin.json
      const cpath = join(this.engine.work, 'marvin.json');
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

      this.logger.info('[ChannelsCommand.execBind]', `agent "${agentId}" bound to channel "${channelId}:${groupId}", config persisted to ${cpath}`);
    }
  }

  // `marvin channels chat [channelId] [groupId]`
  async execChat() {
    this.logger.info('[ChannelsCommand.execChat]', 'sending a message to a channel...');
    
    this.logger.log('');
    
    // ask for channelId
    let channelId = this.args[1] || await select({
      message: 'Enter channel (e.g. slack):',
      choices: listChannels(this.engine).map(id => ({ name: id, value: id })),
    });
    const channel = await loadChannel(this.engine, channelId);
    if (!channel) {
      this.logger.error('[ChannelsCommand.execChat]', `channel "${channelId}" not found`);
      return;
    }

    await channel.load();

    // list available groups as a table
    const info = await channel.info();
    const groups = info.groups || {};
    this.logger.info(' ID        ', '|', 'Name');
    this.logger.info('-----------', '|' ,'----');
    for (const [id, name] of Object.entries(groups)) {
      this.logger.info(`${id}`, '|', `${name}`);
    }
    this.logger.log('');

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
      this.logger.warn('[ChannelsCommand.execChat]', 'invalid groupId, exiting');
      return;
    }

    // ask for message
    const message = await input({ message: 'Message:' });

    this.logger.log('');

    const result = await channel.sendMessage({ role: 'assistant', content: message, group: groupId } as Message);
    if (!result.ok) {
      this.logger.error('[ChannelsCommand.execChat]', `channel "${channelId}" send failed:`, result.error);
      return;
    }

    await channel.drop();

    this.logger.info(`${channelId}:${groupId}: ${message}`);
  }
}
