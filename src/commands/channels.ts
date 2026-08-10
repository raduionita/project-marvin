
import { join } from 'path';
import { writeFileSync } from 'fs';
import { promises } from 'readline';

import { Command, Message } from "../types";
import { listChannels, loadChannel } from '../channels';

// `marvin channels [command] [--dry]` list, add, bind, chat, drop channels
export default class ChannelsCommand extends Command {
  async exec() {
    console.debug('[ChannelsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default: 
        console.warn('[ChannelsCommand.exec]', 'unknown command: channels', cmd); 
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
      // bind a channel:group to an agent
      case 'bind' :  break;
      // `marvin channels chat [channelId] [groupId]` // send message to channel
      case 'chat' :
        await this.execChat();
      break;
      // case 'drop' : break;
    }

    console.debug('[ChannelsCommand.exec]', `done`);
  }

  // `marvin channels help`
  async execHelp() {
    console.info('usage: marvin channels [command]');
    console.info('commands:');
    console.info('  help    ', 'show this help');
    console.info('  list    ', 'list available channels, for each one, it\'s connected agents');
    console.info('  add     ', 'add a channel');
    console.info('  bind <agentId> <channelId> <groupId>', 'bind a channel to an agent');
    console.info('  chat [channelId] [groupId]', 'send a message to a channel');
    console.info('  drop <channelId>', 'drop a channel');
  }

  // `marvin channels list`
  async execList() {
    console.debug('[ChannelsCommand.execList]');
    console.info('list channels:');
    // for each channel, list enabled agents
    listChannels(this.engine).map(c => c.replace('.ts', '')).forEach(channel => {
      console.info(`  ${channel}`);
      const channelConfig = this.engine.config.channels[channel];
      if (channelConfig) {
        console.info('  - enabled:', channelConfig.enabled);
      }
      console.info('  - agents:');
      for (const [agentId, agent] of Object.entries(this.engine.config.agents)) {
        if (!agent.enabled) continue;
        if (!agent.channels[channel]) continue;
        console.info('    -', agentId, ':', `@${agent.channels[channel]}`);
      }
    });
  }

  // `marvin channels add [channelId]`
  async execAdd() {
    console.info('[ChannelsCommand.execAdd]', 'adding a channel...');

    const channels = listChannels(this.engine).map(c => c.replace('.ts', ''));

    console.log('');
    const pli = promises.createInterface({input: process.stdin, output: process.stdout, });

    // ask for channelId
    const channelId = this.args[1] || await pli.question('Enter channel name (e.g. slack): ');
    
    if (!channels.includes(channelId)) {
      console.error('[ChannelsCommand.execAdd]', `unknown channel "${channelId}"`);
      console.error('[ChannelsCommand.execAdd]', 'available channels:', channels.join(', '));
      pli.close();
      return;
    }

    // check if channel is already loaded
    if (this.engine.config.channels[channelId]) {
      console.warn('[ChannelsCommand.execAdd]', `channel "${channelId}" is already loaded`);
      pli.close();
      return;
    }

    const channel = await loadChannel(this.engine, channelId);
    if (!channel) {
      console.error('[ChannelsCommand.execAdd]', `channel "${channelId}" not found`);
      pli.close();
      return;
    }

    const config: Record<string, string> = {};

    // ask for arguments (for each arg in args, ask for value)
    for (const [arg, placeholder] of Object.entries(channel.args)) {
      config[arg] = await pli.question(`Enter ${channelId} ${arg} (e.g. ${placeholder}): `) as string;
    }

    pli.close();
    console.log('');

    // register the channel in config
    this.engine.config.channels[channelId] = { enabled: true, ...config };

    // run load to see if the channel works
    await channel.load();
    await channel.drop();

    // channel works - persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');

    // write to config file
    if (this.engine.isDry) {
      console.info('[ChannelsCommand.execAdd]', '[dry]',`would configure channel ${channelId}, config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }
    
    console.info('[ChannelsCommand.execAdd]', `channel "${channelId}" configured, config persisted to ${cpath}`);
  }

  // `marvin channels bind [agentId] [channelId] [groupId]`
  async execBind() {
    console.info('[ChannelsCommand.execBind]', 'binding a channel:group to an agent...');

    console.log('');
    const pli = promises.createInterface({input: process.stdin, output: process.stdout, });
    // ask for agentId
    const agentId = this.args[1] || await pli.question('Enter agent (e.g. my-agent): ');
    // ask for channelId
    const channelId = this.args[2] || await pli.question('Enter channel (e.g. slack): ');
    // ask for groupId
    const groupId = this.args[3] || await pli.question('Enter group (optional, e.g. general): ');
    pli.close();

    if (!channelId || !agentId) {
      console.warn('[ChannelsCommand.execBind]', 'invalid inputs, exiting');
      return;
    }

    // validate channel exists
    if (!this.engine.config.channels[channelId]) {
      console.error('[ChannelsCommand.execBind]', `channel "${channelId}" not found in config`);
      return;
    }

    // validate agent exists
    if (!this.engine.config.agents[agentId]) {
      console.error('[ChannelsCommand.execBind]', `agent "${agentId}" not found in config`);
      console.error('[ChannelsCommand.execBind]', 'available agents:', Object.keys(this.engine.config.agents).join(', '));
      return;
    }

    if (this.engine.isDry) {
      console.info('[ChannelsCommand.execBind]', '[dry]', `would bind channel ${channelId}:${groupId} to agent ${agentId}`);
    } else {
      // add the binding (overwrites if already bound to this channel)
      this.engine.config.agents[agentId].channels = this.engine.config.agents[agentId].channels || {};
      this.engine.config.agents[agentId].channels[channelId] = groupId; 

      // persist to marvin.json
      const cpath = join(this.engine.work, 'marvin.json');
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

      console.info('[ChannelsCommand.execBind]', `agent "${agentId}" bound to channel "${channelId}:${groupId}", config persisted to ${cpath}`);
    }
  }

  // `marvin channels chat [channelId] [groupId]`
  async execChat() {
    console.info('[ChannelsCommand.execChat]', 'sending a message to a channel...');
    
    console.log('');
    const pli = promises.createInterface({input: process.stdin, output: process.stdout, });
    
    // ask for channelId
    let channelId = this.args[1] || await pli.question('Enter channel (e.g. slack): ');
    const channel = await loadChannel(this.engine, channelId);
    if (!channel) {
      console.error('[ChannelsCommand.execChat]', `channel "${channelId}" not found`);
      return;
    }

    await channel.load();

    // list available groups as a table
    const groups = await channel.listGroups();
    console.info(' ID        ', '|', 'Name');
    console.info('-----------', '|' ,'----');
    for (const [id, name] of Object.entries(groups)) {
      console.info(`${id}`, '|', `${name}`);
    }
    console.log('');

    // ask for groupId
    let groupId = this.args[2] || await pli.question('Enter group (optional, e.g. general): ');

    // find groupId in groups
    for (const [id, name] of Object.entries(groups)) {
      if (name === groupId || id === groupId) {
        groupId = id;
        break;
      }
    }

    if (!groupId) {
      console.warn('[ChannelsCommand.execChat]', 'invalid groupId, exiting');
      return;
    }

    // ask for message
    const message = await pli.question('Message: ');

    pli.close();
    console.log('');

    const result = await channel.sendMessage({ role: 'assistant', content: message, channel: groupId } as Message);
    if (!result.ok) {
      console.error('[ChannelsCommand.execChat]', `channel "${channelId}" send failed:`, result.error);
      return;
    }

    await channel.drop();

    console.info(`${channelId}:${groupId}: ${message}`);
  }
}
