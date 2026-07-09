import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs';
import { execSync } from 'node:child_process';

import readline from 'readline';
import { tryJsonParse } from './helpers.js';
import { Config, App, Channel } from './types.js';
import * as constants from './constants.js';
import { listChannels } from './channels/index.js';

export class Client extends App {
  async init(): Promise<void> {
    const args = process.argv.slice(2);
    console.debug('[marvin]', 'Client.init', args);

    this.initHandlers();
    this.initProject();
    this.initConfig();

    await this.initCommands();

    // placeholder for interaction logic
    console.info('[marvin]', 'client is running. press Ctrl+C to exit');
    
    // keep the client alive for demonstration
    return new Promise((resolve) => {
      setTimeout(() => {
        console.debug('[marvin]', 'finished');
        resolve();
      }, 1000);
    });
  }

  async drop() {
    console.debug('[marvin]', 'Client.drop');
    console.info('[marvin]', 'stopping...');
    // cleanup here
    return;
  }

  // ── Existing methods ────────────────────────────────────────────────────

  initHandlers() {
    console.debug('[marvin]', 'Client.initHandlers');
    // Ctrl+C
    process.on('SIGINT', async () => {
      console.debug('[marvin]', 'SIGINT. terminating...');
      await this.drop();
    });
  }

  initProject() {
    console.debug('[marvin]', 'Client.initProject');

    // set root to the app folder (where package.json lives)
    this.ctx!.root = import.meta.url.replace('file://', '').replace(/\\/g, '/').replace(/\/src\/client\.ts$/, '');

    // create project/workspace folder (~/.marvin)
    const home = join(homedir(), '.marvin');
    if (!existsSync(home)) {
      if (!this.ctx.isDry) {
        mkdirSync(home, { recursive: true });
        console.info('[marvin]', 'created workspace directory:', home);
      } else {
        console.info('[marvin]', '[dry] would create workspace directory:', home);
      }
    }

    // set home (~/.marvin)
    this.ctx!.home = home;

    // agents folder (~/.marvin/agents)
    const apath = join(home, 'agents');
    if (!existsSync(apath)) {
      if (!this.ctx.isDry) {
        mkdirSync(apath, { recursive: true });
        console.info('[marvin]', 'created agents directory:', apath);
      } else {
        console.info('[marvin]', '[dry] would create agents directory:', apath);
      }
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(home, 'MARVIN.md');
    if (!existsSync(mpath)) {
      if (!this.ctx.isDry) {
        writeFileSync(mpath, constants.MARVIN_MD.trim());
        console.info('[marvin]', 'created MARVIN.md:', mpath);
      } else {
        console.debug('[marvin]', '[dry] would write MARVIN.md file:', mpath);
      }
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const cpath = join(home, 'marvin.json');
    if (!existsSync(cpath)) {
      if (!this.ctx.isDry) {
        const config = constants.DEFAULT_CONFIG;
        writeFileSync(cpath, JSON.stringify(config, null, 2));
        console.info('[marvin]', 'created config file:', cpath);
      } else {
        console.info('[marvin]', '[dry] would write config file:', cpath);
      }
    }
  }

  initConfig(config?: Config | undefined) {
    console.debug('[marvin]', 'Client.initConfig', config !== undefined);
    if (config) {
      this.ctx!.config = config;
      return;
    }
    
    // config path
    const cpath = join(this.ctx!.home, 'marvin.json');

    // default config
    config = constants.DEFAULT_CONFIG as Config;

    // at this stage marvin.json MUST exist, but just in case
    if (!existsSync(cpath)) {
      console.error('[marvin]', 'config file not found:', cpath);
      this.ctx!.config = config;
      return;
    }

    // try to parse config file
    try {
      const data = readFileSync(cpath, 'utf8');
      config = JSON.parse(data);
    } catch (err) {
      console.error('[marvin]', 'config file is not valid JSON:', cpath);
      config = constants.DEFAULT_CONFIG as Config;
    } finally {
      this.ctx!.config = config!;
    }
  }

  async initCommands() {
    console.debug('[marvin]', 'Client.initCommands');

    const cmds = process.argv.slice(2);
    const cmd = cmds[0];

    switch (cmd) {
      case 'help'   : await this.execHelp();   break;
      case 'start'  : await this.execStart(); break;
      case 'pause'  : await this.execPause();  break;
      case 'update' : await this.execUpdate(); break;
      case 'version': await this.execVersion(); break;
      case 'status' : await this.execStatus(); break;
      case 'chat'   : await this.execChat(); break;
      case 'reload' : await this.execReload(); break;

      case 'channels' : await this.execChannels(); break;
      case 'models'   : await this.execModels(); break;
      case 'agents'   : await this.execAgents(); break;
      case 'tasks'    : await this.execTasks(); break;
      default: console.warn('[marvin]', 'unknown command:', cmd); break;
    }
  }

  async execHelp(): Promise<void> {
    console.debug('[marvin]', 'Client.execHelp');

    console.info('[marvin]', 'usage: marvin [command] [options]');
    console.info('[marvin]', 'commands:');
    console.info('[marvin]', '  help    ', 'show this help');
    console.info('[marvin]', '  start   ', 'start the daemon');
    console.info('[marvin]', '  pause   ', 'pause the daemon');
    console.info('[marvin]', '  update  ', 'update Marvin to the latest version');
    console.info('[marvin]', '  version ', 'show the current version');
    console.info('[marvin]', '  reload  ', 'reload the daemon');
    console.info('[marvin]', '  status  ', 'check the daemon status');
    console.info('[marvin]', '  chat    ', 'send a chat message');
    console.info('[marvin]', '  channels', 'list, init, bind, drop channels');
  }

  // initialize/launch/start the daemon
  async execStart(): Promise<void> {
    console.debug('[marvin]', 'Client.execStart');

    // check if daemon is already running
    if (!this.ctx.isDry) {
      try {
        const status = execSync(`systemctl --user is-active marvin 2>/dev/null || true`, { encoding: 'utf8' }).trim();
        if (status === 'active') {
          console.info('[marvin]', 'marvin daemon is already running. use "marvin reload" to apply config changes');
          return;
        }
      } catch {
        console.info('[marvin]', 'marvin daemon is not running.');
      }
    } else {
      console.info('[marvin]', '[dry] would check if daemon is already running');
    }

    // install systemd service
    const src = join(this.ctx!.root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (!existsSync(src)) {
      console.error('[marvin]', 'service file missing:', src);
      return;
    }

    if (!this.ctx.isDry) {
      mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
      copyFileSync(src, dst);
      console.info('[marvin]', 'service file installed:', dst);
    } else {
      console.info('[marvin]', '[dry] would copy service file:', src, '->', dst);
      return;
    }

    // ensure workspace
    console.info('[marvin]', 'workspace directory:', this.ctx!.home);
    console.info('[marvin]', 'bootstrap complete.');
    console.info('[marvin]', 'configure', join(this.ctx!.home, 'marvin.json'), 'with your models and channels');
    console.info('[marvin]', 'run: systemctl --user daemon-reload && systemctl --user enable --now marvin');
  }

  // stop/pauses the daemon
  async execPause(): Promise<void> {
    console.debug('[marvin]', 'Client.execPause');

    // TODO: send command to marvin http server to pause (basically pausing the daemon)
  }

  async execUpdate(): Promise<void> {
    console.debug('[marvin]', 'Client.execUpdate');

    const root = join(homedir(), '.local', 'share', 'marvin');

    if (!existsSync(root)) {
      console.error('[marvin] marvin is not installed. run the installer first:');
      console.error('[marvin]   bash install.sh');
      process.exit(1);
    }

    if (!this.ctx.isDry) {
      // git pull from main
      execSync(`git -C ${root} pull origin main`, { stdio: 'inherit' });

      // Reinstall dependencies
      console.log('[marvin] reinstalling dependencies...');
      execSync(`cd ${root} && bun install`, { stdio: 'inherit' });

      // Restart service
      console.log('[marvin] restarting service...');
      execSync(`systemctl --user restart marvin`, { stdio: 'inherit' });

      console.log('[marvin] update complete');
    } else {
      console.log('[marvin] [dry] git pull origin main');
      console.log('[marvin] [dry] bun install');
      console.log('[marvin] [dry] systemctl --user restart marvin');
      console.log('[marvin] [dry] update complete');
    }
  }

  async execVersion(): Promise<void> {
    console.debug('[marvin]', 'Client.execVersion');

    const root = join(homedir(), '.local', 'share', 'marvin');
    const pkgPath = join(root, 'package.json');

    if (!existsSync(pkgPath)) {
      console.error('[marvin]', 'package.json not found.');
      process.exit(1);
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const version = pkg.version || 'unknown';
    console.log('[marvin]', 'v' + version);
  }

  async execStatus(): Promise<void> {
    console.debug('[marvin]', 'Client.execStatus');

    const cmds = process.argv.slice(2);
    const cmd = cmds[1];

    switch (cmd) {
      case 'help'   : 
        console.debug('[marvin]', 'usage: marvin status [command]', 'check the daemon status');
        console.debug('[marvin]', 'commands:');
        console.debug('[marvin]', '  help    ', 'show this help');
      break;
      default: {
        // service status
        if (!this.ctx.isDry) {
          try {
            const status = execSync(`systemctl --user status marvin 2>&1 || true`, { encoding: 'utf8' });
            console.log('[marvin]', 'service status:', status.trim());
          } catch {
            console.log('[marvin] service is not running.');
          }
        } else {
          console.log('[marvin] [dry] would check systemd service status: marvin');
        }

        // TODO: replace health w/ GET status

        // health check
        const port = this.ctx!.config?.settings?.port || 7331;
        if (!this.ctx.isDry) {
          try {
            const url = new URL(`http://localhost:${port}/_health`);
            const response = await fetch(url.toString());
            if (response.ok) {
              console.log('[marvin]', `server is healthy (port ${port}).`);
            } else {
              console.warn(`[marvin]`, `server responded with ${response.status}.`);
            }
          } catch (err) {
            console.error(`[marvin]`,`cannot reach server at localhost:${port}.`);
          }
        } else {
          console.log('[marvin] [dry] would check health endpoint: http://localhost:' + port + '/_health');
        } 
      } break;
    }
  }

  // send reload command to server
  async execReload() {
    console.debug('[marvin]', 'Client.execReload');

    const url = new URL(`http://localhost:${this.ctx!.config.settings.port}/`);
    url.pathname = '/reload';

    if (!this.ctx.isDry) {
      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`Client.execReload: Error ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } else {
      console.log('[marvin]', '[dry] would send reload to:', url.toString());
      return;
    }
  }

  async execChannels(): Promise<void> {
    console.debug('[marvin]', 'Client.execChannels');

    const cmds = process.argv.slice(2);
    const cmd = cmds[1];

    switch (cmd) {
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
      default: console.warn('[marvin]', 'unknown command: channels', cmd); break;
    }
  }

  async execChat(): Promise<void> {
    console.debug('[marvin]', 'Client.execChat');

    const cmds = process.argv.slice(2);
    const flags: Record<string, string> = {};
    let positional = '';

    for (const arg of cmds) {
      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        const val = cmds[cmds.indexOf(arg) + 1];
        if (val && !val.startsWith('--')) {
          flags[key] = val;
        }
      } else {
        positional = arg;
      }
    }

    const message = positional;
    const agentId = flags.agentId || this.ctx!.config.settings?.name;

    // Build URL to server chat endpoint
    const port = this.ctx!.config?.settings?.port || 7331;
    const url = new URL(`http://localhost:${port}/chat`);

    if (this.ctx.isDry) {
      console.info('[marvin]', '[dry] would send chat to:', url.toString());
      console.info('[marvin]', 'message:', message || '(interactive)');
      console.info('[marvin]', 'agent:', agentId);
      return;
    }

    // If no message provided via CLI, prompt interactively
    let chatMessage = message;
    if (!chatMessage) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await new Promise<string>((resolve) => {
        rl.question('Message: ', (ans: string) => {
          resolve(ans);
          rl.close();
        });
      });
      if (!answer.trim()) {
        console.warn('[marvin]', 'empty message');
        return;
      }
      chatMessage = answer;
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: chatMessage,
        agentId,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[marvin]', 'chat error:', (data as { error?: string }).error || res.statusText);
      return;
    }
    const result = data as { ok: boolean; data: { content: string; steps: number; agentId: string } };
    if (result.ok) {
      console.info('[marvin]', `agent=${result.data.agentId} steps=${result.data.steps}`);
      console.info('[marvin]', result.data.content);
    }
  }

  async execModels(): Promise<void> {
    console.debug('[marvin]', 'Client.execModels');
  }

  async execAgents(): Promise<void> {
    console.debug('[marvin]', 'Client.execAgents');
  }

  async execTasks(): Promise<void> {
    console.debug('[marvin]', 'Client.execTasks');
  } 
}
