
import { join } from 'path';
import { writeFileSync } from 'fs';
import readline, { promises } from 'readline';

import { Channel, Command } from "../types";
import { listChannels } from '../channels';

export default class ChannelsCommand extends Command {
  async exec() {
    console.debug('[ChannelsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default: 
        console.warn('[ChannelsCommand.exec]', 'unknown command: channels', cmd); 
      case 'help'   : // default = empty = help 
        console.info('usage: marvin channels [command]');
        console.info('commands:');
        console.info('  help    ', 'show this help');
        console.info('  list    ', 'list available channels, for each one, it\'s connected agents');
        console.info('  add     ', 'add a channel');
        console.info('  bind <agentId> <channelId> <groupId>', 'bind a channel to an agent');
        console.info('  remove <channelId>', 'drop a channel');
      break;
      case 'list' : { // list available channels, for each one, it's connected agents
        console.info('list channels:');
        // for each channel, list enabled agents
        listChannels(this.engine).forEach(channel => {
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
      } break;
      case 'add' : {
        // TODO: refactor to use readline prompts

        const channels = listChannels(this.engine).map(c => c.replace('.ts', ''));

        console.log('');
        const pli = promises.createInterface({input: process.stdin, output: process.stdout, });

        const channelId = await pli.question('Enter channel name (e.g. slack): ');
        
        if (!channels.includes(channelId)) {
          console.error('[ChannelsCommand.exec]', `unknown channel "${channelId}"`);
          console.error('[ChannelsCommand.exec]', 'available channels:', channels.join(', '));
          pli.close();
          break;
        }

        // check if channel is already loaded
        if (this.engine.config.channels[channelId]) {
          console.warn('[ChannelsCommand.exec]', `channel "${channelId}" is already loaded`);
          pli.close();
          break;
        }

        // dynamically import the channel class (see: server.ts Server.loadChannels)
        const Module = await import(`../channels/${channelId}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.error('[ChannelsCommand.exec]', `${channelId} does not export a Channel class`);
          pli.close();
          return;
        }

        // ask for arguments (for each arg in args, ask for value)
        const channel = new Class(this.engine);
        const config: Record<string, string> = {};

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
        const cpath = join(this.engine.home, 'marvin.json');

        // write to config file
        if (this.engine.isDry) {
          console.info('[ChannelsCommand.exec]', '[dry]',`would configure channel ${channelId}, config persisted to ${cpath}`);
        } else {
          writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
        }
        
        console.info('[ChannelsCommand.exec]', `channel "${channelId}" configured, config persisted to ${cpath}`);
    } break;
      case 'bind' : {
        console.info('[ChannelsCommand.exec]', 'binding a channel:group to an agent...');

        console.log('');
        const pli = promises.createInterface({input: process.stdin, output: process.stdout, });
        const agentId = await pli.question('Enter agent (e.g. my-agent): ');
        const channelId = await pli.question('Enter channel (e.g. slack): ');
        const groupId = await pli.question('Enter group (optional, e.g. general): ');
        pli.close();

        if (!channelId || !agentId) {
          console.warn('[ChannelsCommand.exec]', 'invalid inputs, exiting');
          break;
        }

        // validate channel exists
        if (!this.engine.config.channels[channelId]) {
          console.error('[ChannelsCommand.exec]', `channel "${channelId}" not found in config`);
          return;
        }

        // validate agent exists
        if (!this.engine.config.agents[agentId]) {
          console.error('[ChannelsCommand.exec]', `agent "${agentId}" not found in config`);
          console.error('[ChannelsCommand.exec]', 'available agents:', Object.keys(this.engine.config.agents).join(', '));
          return;
        }

        if (this.engine.isDry) {
          console.info('[ChannelsCommand.exec]', '[dry]', `would bind channel ${channelId}:${groupId} to agent ${agentId}`);
        } else {
          // add the binding (overwrites if already bound to this channel)
          this.engine.config.agents[agentId].channels = this.engine.config.agents[agentId].channels || {};
          this.engine.config.agents[agentId].channels[channelId] = groupId; 

          // persist to marvin.json
          const cpath = join(this.engine.home, 'marvin.json');
          writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

          console.info('[ChannelsCommand.exec]', `agent "${agentId}" bound to channel "${channelId}:${groupId}", config persisted to ${cpath}`);
        }
      } break;
      // case 'drop' : break;
    }
  }
}
