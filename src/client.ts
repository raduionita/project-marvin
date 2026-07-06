import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs';
import { execSync } from 'node:child_process';

import { tryJsonParse } from './helpers.js';
import { Config, App } from './types.js';
import * as constants from './constants.js';
import { listChannels } from './channels/index.js';

export class Client extends App {
  async init(): Promise<void> {
    const args = process.argv.slice(2);
    console.debug('[marvin]', 'Client.init', args);

    this.initHandlers();
    this.initProject();
    this.initConfig();
    this.initCommands();

    // placeholder for interaction logic
    console.debug('[marvin]', 'Client.init' ,'client is running. press Ctrl+C to exit.');
    
    // keep the client alive for demonstration
    return new Promise((resolve) => {
      setTimeout(() => {
        console.debug('[marvin]', 'Client.init', 'finished');
        resolve();
      }, 1000);
    });
  }

  async drop() {
    console.debug('[marvin]', 'Client.drop');
  }

  // ── Existing methods ────────────────────────────────────────────────────

  initHandlers() {
    console.debug('[marvin]', 'Client.initHandlers');
    // Ctrl+C
    process.on('SIGINT', () => {
      console.debug('[marvin]', 'Client.initHandlers', 'SIGINT. terminating...');
      process.exit(0);
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
      } else {
        console.debug('[marvin]', 'Client.initProject', '[dry] would create directory:', home);
      }
    }

    // set home (~/.marvin)
    this.ctx!.home = home;

    // agents folder (~/.marvin/agents)
    const apath = join(home, 'agents');
    if (!existsSync(apath)) {
      if (!this.ctx.isDry) {
        mkdirSync(apath, { recursive: true });
      } else {
        console.debug('[marvin]', 'Client.initProject', '[dry] would create directory:', apath);
      }
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(home, 'MARVIN.md');
    if (!existsSync(mpath)) {
      if (!this.ctx.isDry) {
        writeFileSync(mpath, constants.MARVIN_MD.trim());
      } else {
        console.debug('[marvin]', 'Client.initProject', '[dry] would write file:', mpath);
      }
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const path = join(home, 'marvin.json');
    if (!existsSync(path)) {
      if (!this.ctx.isDry) {
        const config = constants.DEFAULT_CONFIG;
        writeFileSync(path, JSON.stringify(config, null, 2));
      } else {
        console.debug('[marvin]', 'Client.initProject', '[dry] would write file:', path);
      }
    }
  }

  initConfig(config?: Config | undefined) {
    console.debug('[marvin]', 'Client.initConfig', config !== undefined);
    if (config) {
      this.ctx!.config = config;
      return;
    }
    
    const path = join(this.ctx!.home, 'marvin.json');

    config = {} as Config;

    // at this stage marvin.json MUST exist, but just in case
    if (!existsSync(path)) {
      console.error('[marvin]', 'Client.initConfig', 'config file not found:', path);
      this.ctx!.config = constants.DEFAULT_CONFIG as Config;
      return;
    }

    const data = readFileSync(path, 'utf8');
    config = tryJsonParse(data);

    this.ctx!.config = config!;
  }

  async initCommands() {
    console.debug('[marvin]', 'Client.initCommands');

    const cmds = process.argv.slice(2);
    const cmd = cmds[0];

    switch (cmd) {
      case 'help'   : await this.execHelp();   break;
      case 'launch' : await this.execLaunch(); break;
      case 'pause'  : await this.execPause();  break;
      case 'update' : await this.execUpdate(); break;
      case 'version': await this.execVersion(); break;
      case 'status' : await this.execStatus(); break;
      case 'reload' : await this.execReload(); break;

      case 'channels' : await this.execChannels(); break;
      case 'models'   : await this.execModels(); break;
      case 'agents'   : await this.execAgents(); break;
      case 'tasks'    : await this.execTasks(); break;
      default: console.warn('[marvin]', 'Client.initCommands', 'unknown command:', cmd); break;
    }
  }

  async execHelp(): Promise<void> {
    console.debug('[marvin]', 'Client.execHelp');

    console.debug('[marvin]', 'Client.execHelp', 'usage: marvin [command]');
    console.debug('[marvin]', 'Client.execHelp', 'commands:');
    console.debug('[marvin]', 'Client.execHelp', '  launch  launch the daemon');
    console.debug('[marvin]', 'Client.execHelp', '  pause   pause the daemon');
    console.debug('[marvin]', 'Client.execHelp', '  update  update Marvin to the latest version');
    console.debug('[marvin]', 'Client.execHelp', '  version show the current version');
    console.debug('[marvin]', 'Client.execHelp', '  status  check the daemon status');
    console.debug('[marvin]', 'Client.execHelp', '  reload  reload the daemon');
  }

  // initialize/launch/start the daemon
  async execLaunch(): Promise<void> {
    console.debug('[marvin]', 'Client.execLaunch');

    // TOCO: check if daemon is already running, systemd/systectl, if so, restart it

    // install systemd service
    const src = join(this.ctx!.root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (existsSync(src)) {
      if (!this.ctx.isDry) {
        mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
        copyFileSync(src, dst);
        console.debug('[marvin]', 'Client.execLaunch', 'service file installed:', dst);
      } else {
        console.debug('[marvin]', 'Client.execLaunch', '[dry] would copy service file:', src, '->', dst);
      }
    } else {
      console.warn('[marvin]', 'Client.execLaunch', 'service file not found at marvin.service');
    }

    // ensure workspace
    console.debug('[marvin]', 'Client.execLaunch', 'workspace directory:', this.ctx!.home);
    console.debug('[marvin]', 'Client.execLaunch', 'bootstrap complete.');
    console.debug('[marvin]', 'Client.execLaunch', 'configure', join(this.ctx!.home, 'marvin.json'), 'with your models and channels.');
    console.debug('[marvin]', 'Client.execLaunch', 'run: systemctl --user daemon-reload && systemctl --user enable --now marvin');
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
      console.error('[marvin] Marvin is not installed. Run the installer first:');
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
      console.log('[marvin] Restarting service...');
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
      console.error('[marvin]', 'Client.execVersion' ,'package.json not found.');
      process.exit(1);
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const version = pkg.version || 'unknown';
    console.log('[marvin]', 'v' + version);
  }

  async execStatus(): Promise<void> {
    console.debug('[marvin]', 'Client.execStatus');

    // service status
    if (!this.ctx.isDry) {
      try {
        const status = execSync(`systemctl --user status marvin 2>&1 || true`, { encoding: 'utf8' });
        console.log(status);
      } catch {
        console.log('[marvin] Service is not running.');
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
      console.log('[marvin] [dry] would send reload to:', url.toString());
      return {};
    }
  }

  async execChannels(): Promise<void> {
    console.debug('[marvin]', 'Client.execChannels');
    const cmds = process.argv.slice(2);
    const cmd = cmds[1];

    switch (cmd) {
      case 'help'   : 
        console.debug('[marvin]', 'Client.execChannels', 'usage: marvin channels [command]');
      break;
      case 'list': // list available channels, for each one, it's connected agents
      case 'ls'  : 
        console.debug('[marvin]', 'Client.execChannels', 'list channels');
        // for each channel, list enabled agents
        listChannels(this.ctx!).forEach(channel => {
          console.debug('[marvin]', channel);
          console.debug('[marvin]', '- enabled:', this.ctx!.config.channels[channel]!.enabled);
          console.debug('[marvin]', '- agents:');
          for (const [agentId, agent] of Object.entries(this.ctx!.config.agents)) {
            if (!agent.enabled) continue;
            if (!agent.channels[channel]) continue;
            console.debug('[marvin]', '  -', agentId, ':', `@${agent.channels[channel]}`);
          }
        });
      break;
      case 'init' :
        const name = cmds[2];
        console.debug('[marvin]', 'Client.execChannels', 'init channel', name);

        // TODO: check if channel is already initialized
        // TODO: channel MUST exist in listChannels
        
        // see: server.ts Server.initChannels on how to load a channel

        // TODO: ask for arguments
        // const channel = new Class(this.ctx);
        // const args = channel.args();
        // TODO: for each arg in args, ask for value

        // the channel is added to config.channels and marvin.json

        // TODO: run init to see if the channel works?!

      break;
      case 'bind' : 
        console.debug('[marvin]', 'Client.execChannels', 'bind channel');

        // bings channel to agent


      break;
      // case 'delete' : await this.execChannelsDelete(); break;
      default: console.warn('[marvin]', 'Client.execChannels', 'unknown command: channels', cmd); break;
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
