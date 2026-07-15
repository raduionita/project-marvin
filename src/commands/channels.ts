
import { join } from 'path';
import { writeFileSync } from 'fs';
import readline from 'readline';

import { Channel, Command } from "../types";
import { listChannels } from '../channels';

export default class ChannelsCommand extends Command {
  async init() {
    console.debug('[ChannelsCommand.init]');

    const cmds = process.argv.slice(2);
    const cmd = cmds[1] || 'help';

    switch (cmd) {
      default: 
        console.warn('unknown command: channels', cmd); 
      case ''       :  
      case 'help'   : // default = empty = help 
        console.log('usage: marvin channels [command]');
        console.log('commands:');
        console.log('  help    ', 'show this help');
        console.log('  list    ', 'list available channels, for each one, it\'s connected agents');
        console.log('  init    ', 'initialize a channel');
        console.log('  bind    ', 'bind a channel to an agent');
        console.log('  bind <agentId> <channelId> <groupId>');
        console.log('  drop    ', 'drop a channel');
        console.log('  drop <channelId>');
      break;
      case 'list' : { // list available channels, for each one, it's connected agents
        console.log('list channels');
        // for each channel, list enabled agents
        listChannels(this.ctx!).forEach(channel => {
          console.debug(channel);
          const channelConfig = this.ctx!.config.channels[channel];
          if (channelConfig) {
            console.log('- enabled:', channelConfig.enabled);
          }
          console.debug('[- agents:]');
          for (const [agentId, agent] of Object.entries(this.ctx!.config.agents)) {
            if (!agent.enabled) continue;
            if (!agent.channels[channel]) continue;
            console.log('  -', agentId, ':', `@${agent.channels[channel]}`);
          }
        });
      } break;
      case 'init' : {
        const channelId = cmds[2];

        // warn and stop if no name (channelId) provided
        if (!channelId) {
          console.warn('usage: marvin channels init <name>');
          console.warn('available channels:', listChannels(this.ctx!).join(', '));
          break;
        }

        // check if channel is already initialized
        if (this.ctx!.config.channels[channelId]) {
          console.warn(`channel "${channelId}" is already initialized`);
          break;
        }

        // channel MUST exist in listChannels
        const available = listChannels(this.ctx!);
        if (!available.includes(channelId)) {
          console.error(`unknown channel "${channelId}"`);
          console.error('available channels:', available.join(', '));
          return;
        }

        // dynamically import the channel class (see: server.ts Server.initChannels)
        const Module = await import(`./channels/${channelId}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.error(`${channelId} does not export a Channel class`);
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

        // run init to see if the channel works
        await channel.init();
        await channel.drop();

        // channel works — persist to marvin.json
        const cpath = join(this.ctx!.home, 'marvin.json');

        // write to config file
        if (this.ctx.isDry) {
          console.info(`[dry] would configure channel ${channelId}, config persisted to ${cpath}`);
        } else {
          writeFileSync(cpath, JSON.stringify(this.ctx.config, null, 2));
        }
        
        console.info(`channel "${channelId}" configured, config persisted to ${cpath}`);
    } break;
      case 'bind' : {
        console.info('binding a channel:group to an agent...');
        const agentId = cmds[2];
        const channelId = cmds[3];
        const groupId = cmds[4] || cmd[3] || ''; // optional

        if (!channelId || !agentId) {
          console.warn('invalid arguments');
          console.warn('usage: marvin channels bind <agentId> <channelId> <groupId>');
          break;
        }

        // validate channel exists
        if (!this.ctx!.config.channels[channelId]) {
          console.error(`channel "${channelId}" not found in config`);
          return;
        }

        // validate agent exists
        if (!this.ctx!.config.agents[agentId]) {
          console.error(`agent "${agentId}" not found in config`);
          console.error('available agents:', Object.keys(this.ctx!.config.agents).join(', '));
          return;
        }

        if (this.ctx.isDry) {
          console.info(`[dry] would bind channel ${channelId}:${groupId} to agent ${agentId}`);
        } else {
          // add the binding (overwrites if already bound to this channel)
          this.ctx!.config.agents[agentId].channels = this.ctx!.config.agents[agentId].channels || {};
          this.ctx!.config.agents[agentId].channels[channelId] = groupId; 

          // persist to marvin.json
          const cpath = join(this.ctx!.home, 'marvin.json');
          writeFileSync(cpath, JSON.stringify(this.ctx!.config, null, 2));

          console.info(`agent "${agentId}" bound to channel "${channelId}:${groupId}", config persisted to ${cpath}`);
        }
      } break;
      // case 'drop' : await this.execChannelsDelete(); break;
    }
  }
}
