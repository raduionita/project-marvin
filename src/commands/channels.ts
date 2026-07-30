
import { join } from 'path';
import { writeFileSync } from 'fs';
import readline from 'readline';

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
        console.log('[ChannelsCommand.exec]', 'usage: marvin channels [command]');
        console.log('[ChannelsCommand.exec]', 'commands:');
        console.log('[ChannelsCommand.exec]', '  help    ', 'show this help');
        console.log('[ChannelsCommand.exec]', '  list    ', 'list available channels, for each one, it\'s connected agents');
        console.log('[ChannelsCommand.exec]', '  add     ', 'add a channel');
        console.log('[ChannelsCommand.exec]', '  bind <agentId> <channelId> <groupId>', 'bind a channel to an agent');
        console.log('[ChannelsCommand.exec]', '  remove <channelId>', 'drop a channel');
      break;
      case 'list' : { // list available channels, for each one, it's connected agents
        console.log('[ChannelsCommand.exec]', 'list channels');
        // for each channel, list enabled agents
        listChannels(this.ctx!).forEach(channel => {
          console.debug('[ChannelsCommand.exec]', channel);
          const channelConfig = this.ctx!.config.channels[channel];
          if (channelConfig) {
            console.log('[ChannelsCommand.exec]', '- enabled:', channelConfig.enabled);
          }
          console.debug('[ChannelsCommand.exec]', '[- agents:]');
          for (const [agentId, agent] of Object.entries(this.ctx!.config.agents)) {
            if (!agent.enabled) continue;
            if (!agent.channels[channel]) continue;
            console.log('[ChannelsCommand.exec]', '  -', agentId, ':', `@${agent.channels[channel]}`);
          }
        });
      } break;
      case 'add' : {
        // TODO: refactor to use readline prompts

        const channelId = this.args[1];

        // warn and stop if no name (channelId) provided
        if (!channelId) {
          console.warn('[ChannelsCommand.exec]', 'usage: marvin channels load <name>');
          console.warn('[ChannelsCommand.exec]', 'available channels:', listChannels(this.ctx!).join(', '));
          break;
        }

        // check if channel is already loaded
        if (this.ctx!.config.channels[channelId]) {
          console.warn('[ChannelsCommand.exec]', `channel "${channelId}" is already loaded`);
          break;
        }

        // channel MUST exist in listChannels
        const available = listChannels(this.ctx!);
        if (!available.includes(channelId)) {
          console.error('[ChannelsCommand.exec]', `unknown channel "${channelId}"`);
          console.error('[ChannelsCommand.exec]', 'available channels:', available.join(', '));
          return;
        }

        // dynamically import the channel class (see: server.ts Server.loadChannels)
        const Module = await import(`./channels/${channelId}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.error('[ChannelsCommand.exec]', `${channelId} does not export a Channel class`);
          return;
        }

        // ask for arguments (for each arg in args, ask for value)
        const channel = new Class(this.ctx!);
        const args = channel.args();
        const config: Record<string, string> = {};
        for (const [arg, placeholder] of Object.entries(args) as [string, string][]) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = await new Promise<string>((resolve) => {
            rl.question(`Enter ${channelId} ${arg}: `, (ans: string) => {
              resolve(ans);
              rl.close();
            });
          });
          config[arg] = answer;
        }

        // register the channel in config
        this.ctx!.config.channels[channelId] = { enabled: true, ...config };

        // run load to see if the channel works
        await channel.load();
        await channel.drop();

        // channel works - persist to marvin.json
        const cpath = join(this.ctx!.home, 'marvin.json');

        // write to config file
        if (this.ctx.isDry) {
          console.info('[ChannelsCommand.exec]', '[dry]',`would configure channel ${channelId}, config persisted to ${cpath}`);
        } else {
          writeFileSync(cpath, JSON.stringify(this.ctx.config, null, 2));
        }
        
        console.info('[ChannelsCommand.exec]', `channel "${channelId}" configured, config persisted to ${cpath}`);
    } break;
      case 'bind' : {
        console.info('[ChannelsCommand.exec]', 'binding a channel:group to an agent...');
        const agentId = this.args[1];
        const channelId = this.args[2];
        const groupId = this.args[3] || ''; // optional

        if (!channelId || !agentId) {
          console.warn('[ChannelsCommand.exec]', 'invalid arguments');
          console.warn('[ChannelsCommand.exec]', 'usage: marvin channels bind <agentId> <channelId> <groupId>');
          break;
        }

        // validate channel exists
        if (!this.ctx!.config.channels[channelId]) {
          console.error('[ChannelsCommand.exec]', `channel "${channelId}" not found in config`);
          return;
        }

        // validate agent exists
        if (!this.ctx!.config.agents[agentId]) {
          console.error('[ChannelsCommand.exec]', `agent "${agentId}" not found in config`);
          console.error('[ChannelsCommand.exec]', 'available agents:', Object.keys(this.ctx!.config.agents).join(', '));
          return;
        }

        if (this.ctx.isDry) {
          console.info('[ChannelsCommand.exec]', '[dry]', `would bind channel ${channelId}:${groupId} to agent ${agentId}`);
        } else {
          // add the binding (overwrites if already bound to this channel)
          this.ctx!.config.agents[agentId].channels = this.ctx!.config.agents[agentId].channels || {};
          this.ctx!.config.agents[agentId].channels[channelId] = groupId; 

          // persist to marvin.json
          const cpath = join(this.ctx!.home, 'marvin.json');
          writeFileSync(cpath, JSON.stringify(this.ctx!.config, null, 2));

          console.info('[ChannelsCommand.exec]', `agent "${agentId}" bound to channel "${channelId}:${groupId}", config persisted to ${cpath}`);
        }
      } break;
      // case 'drop' : break;
    }
  }
}
