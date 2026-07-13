
import { join } from 'path';
import { writeFileSync } from 'fs';
import readline from 'readline';

import { Channel, Command } from "../types";
import { listChannels } from '../channels';

export default class ChannelsCommand extends Command {
  async init() {
    console.debug('[marvin]', 'ChannelsCommand.init');

    const cmds = process.argv.slice(2);
    const cmd = cmds[1];

    switch (cmd) {
      default: 
        console.warn('[marvin]', 'unknown command: channels', cmd); 
      case 'help'   : 
        console.debug('[marvin]', 'usage: marvin channels [command]');
        console.debug('[marvin]', 'commands:');
        console.debug('[marvin]', '  help    ', 'show this help');
        console.debug('[marvin]', '  list    ', 'list available channels, for each one, it\'s connected agents');
        console.debug('[marvin]', '  init    ', 'initialize a channel');
        console.debug('[marvin]', '  bind    ', 'bind a channel to an agent');
        console.debug('[marvin]', '  bind <agentId> <channelId> <groupId>');
        console.debug('[marvin]', '  drop    ', 'drop a channel');
        console.debug('[marvin]', '  drop <channelId>');
      break;
      case 'list' : { // list available channels, for each one, it's connected agents
        console.debug('[marvin]', 'list channels');
        // for each channel, list enabled agents
        listChannels(this.ctx!).forEach(channel => {
          console.debug('[marvin]', channel);
          const channelConfig = this.ctx!.config.channels[channel];
          if (channelConfig) {
            console.debug('[marvin]', '- enabled:', channelConfig.enabled);
          }
          console.debug('[marvin]', '- agents:');
          for (const [agentId, agent] of Object.entries(this.ctx!.config.agents)) {
            if (!agent.enabled) continue;
            if (!agent.channels[channel]) continue;
            console.debug('[marvin]', '  -', agentId, ':', `@${agent.channels[channel]}`);
          }
        });
      } break;
      case 'init' : {
        const channelId = cmds[2];

        // warn and stop if no name (channelId) provided
        if (!channelId) {
          console.warn('[marvin]', 'usage: marvin channels init <name>');
          console.warn('[marvin]', 'available channels:', listChannels(this.ctx!).join(', '));
          break;
        }

        // check if channel is already initialized
        if (this.ctx!.config.channels[channelId]) {
          console.warn('[marvin]', `channel "${channelId}" is already initialized`);
          break;
        }

        // channel MUST exist in listChannels
        const available = listChannels(this.ctx!);
        if (!available.includes(channelId)) {
          console.error('[marvin]', `unknown channel "${channelId}"`);
          console.error('[marvin]', 'available channels:', available.join(', '));
          return;
        }

        // dynamically import the channel class (see: server.ts Server.initChannels)
        const Module = await import(`./channels/${channelId}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Channel)) {
          console.error('[marvin]', `${channelId} does not export a Channel class`);
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
        const configPath = join(this.ctx!.home, 'marvin.json');
        writeFileSync(configPath, JSON.stringify(this.ctx!.config, null, 2));
        
        console.log('[marvin]', `channel "${channelId}" configured, config persisted to ${configPath}`);
    } break;
      case 'bind' : {
        console.info('[marvin]', 'binding a channel:group to an agent...');
        const agentId = cmds[2];
        const channelId = cmds[3];
        const groupId = cmds[4] || cmd[3] || ''; // optional

        if (!channelId || !agentId) {
          console.warn('[marvin]', 'invalid arguments');
          console.warn('[marvin]', 'usage: marvin channels bind <agentId> <channelId> <groupId>');
          break;
        }

        // validate channel exists
        if (!this.ctx!.config.channels[channelId]) {
          console.error('[marvin]', `channel "${channelId}" not found in config`);
          return;
        }

        // validate agent exists
        if (!this.ctx!.config.agents[agentId]) {
          console.error('[marvin]', `agent "${agentId}" not found in config`);
          console.error('[marvin]', 'available agents:', Object.keys(this.ctx!.config.agents).join(', '));
          return;
        }

        if (!this.ctx!.isDry) {
          // add the binding (overwrites if already bound to this channel)
          this.ctx!.config.agents[agentId].channels = this.ctx!.config.agents[agentId].channels || {};
          this.ctx!.config.agents[agentId].channels[channelId] = groupId; 

          // persist to marvin.json
          const cpath = join(this.ctx!.home, 'marvin.json');
          writeFileSync(cpath, JSON.stringify(this.ctx!.config, null, 2));

          console.log('[marvin]', `agent "${agentId}" bound to channel "${channelId}:${groupId}", config persisted to ${cpath}`);
        } else {
          console.info('[marvin]', `[dry] would bind channel ${channelId}:${groupId} to agent ${agentId}`);
          return;
        }
      } break;
      // case 'drop' : await this.execChannelsDelete(); break;
    }
  }
}
