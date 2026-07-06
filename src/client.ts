import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs';
import { execSync } from 'node:child_process';

import { tryJsonParse } from './helpers.js';
import { Config, App } from './types.js';
import * as constants from './constants.js';

const GITHUB_OWNER = 'raduionita';
const GITHUB_REPO = 'marvin';

export class Client extends App {
  async init(): Promise<void> {
    const args = process.argv.slice(2);
    console.log('[marvin]', 'Client.init', args);

    this.initHandlers();
    this.initProject();
    this.initConfig();
    this.initCommands();

    // placeholder for interaction logic
    console.log('[marvin]', 'Client.init' ,'client is running. press Ctrl+C to exit.');
    
    // keep the client alive for demonstration
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('[marvin]', 'Client.init', 'finished');
        resolve();
      }, 1000);
    });
  }

  async drop() {
    console.log('[marvin]', 'Client.drop');
  }

  // ── Existing methods ────────────────────────────────────────────────────

  initHandlers() {
    console.log('[marvin]', 'Client.initHandlers');
    // Ctrl+C
    process.on('SIGINT', () => {
      console.log('[marvin]', 'Client.initHandlers', 'SIGINT. terminating...');
      process.exit(0);
    });
  }

  initProject() {
    console.log('[marvin]', 'Client.initProject');

    // set root to the app folder (where package.json lives)
    this.ctx!.root = import.meta.url.replace('file://', '').replace(/\\/g, '/').replace(/\/src\/client\.ts$/, '');

    // create project/workspace folder (~/.marvin)
    const home = join(homedir(), '.marvin');
    if (!existsSync(home)) {
      mkdirSync(home, { recursive: true });
    }

    // set home (~/.marvin)
    this.ctx!.home = home;

    // agents folder (~/.marvin/agents)
    const apath = join(home, 'agents');
    if (!existsSync(apath)) {
      mkdirSync(apath, { recursive: true });
    }

    // create ~/.marvin/MARVIN.md from constants (orchestrator identity)
    const mpath = join(home, 'MARVIN.md');
    if (!existsSync(mpath)) {
      writeFileSync(mpath, constants.MARVIN_MD.trim());
    }

    // create marvin.json if missing (~/.marvin/marvin.json)
    const path = join(home, 'marvin.json');
    if (!existsSync(path)) {
      const config = constants.DEFAULT_CONFIG;
      writeFileSync(path, JSON.stringify(config, null, 2));
    }
  }

  initConfig(config?: Config | undefined) {
    console.log('[marvin]', 'Client.initConfig', config !== undefined);
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
    console.log('[marvin]', 'Client.initCommands');

    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
      case 'help'  : await this.execHelp();   break;
      case 'launch': await this.execLaunch(); break;
      case 'pause' : await this.execPause();  break;
      case 'update': await this.execUpdate(); break;
      case 'status': await this.execStatus(); break;
      case 'reload': await this.execReload(); break;
      default: console.warn('[marvin]', 'Client.initCommands', 'unknown command:', command); break;
    }
  }

  async execHelp(): Promise<void> {
    console.log('[marvin]', 'Client.execHelp');

    console.log('[marvin]', 'Client.execHelp', 'usage: marvin [command]');
    console.log('[marvin]', 'Client.execHelp', 'commands:');
    console.log('[marvin]', 'Client.execHelp', '  launch  launch the daemon');
    console.log('[marvin]', 'Client.execHelp', '  pause   pause the daemon');
    console.log('[marvin]', 'Client.execHelp', '  update  update Marvin to the latest version');
    console.log('[marvin]', 'Client.execHelp', '  status  check the daemon status');
    console.log('[marvin]', 'Client.execHelp', '  reload  reload the daemon');
  }

  // initialize/launch/start the daemon
  async execLaunch(): Promise<void> {
    console.log('[marvin]', 'Client.execLaunch');

    // TOCO: check if daemon is already running, systemd/systectl, if so, restart it

    // install systemd service
    const src = join(this.ctx!.root, 'marvin.service');
    const dst = join(homedir(), '.config', 'systemd', 'user', 'marvin.service');
    if (existsSync(src)) {
      mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
      copyFileSync(src, dst);
      console.log('[marvin]', 'Client.execLaunch', 'service file installed:', dst);
    } else {
      console.warn('[marvin]', 'Client.execLaunch', 'service file not found at marvin.service');
    }

    // ensure workspace
    console.log('[marvin]', 'Client.execLaunch', 'workspace directory:', this.ctx!.home);
    console.log('[marvin]', 'Client.execLaunch', 'bootstrap complete.');
    console.log('[marvin]', 'Client.execLaunch', 'configure', join(this.ctx!.home, 'marvin.json'), 'with your models and channels.');
    console.log('[marvin]', 'Client.execLaunch', 'run: systemctl --user daemon-reload && systemctl --user enable --now marvin');
  }

  // stop/pauses the daemon
  async execPause(): Promise<void> {
    console.log('[marvin]', 'Client.execPause');

    // TODO: send command to marvin http server to pause (basically pausing the daemon)
  }

  async execUpdate(): Promise<void> {
    console.log('[marvin]', 'Client.execUpdate');

    const installDir = join(homedir(), '.local', 'share', 'marvin');
    const installDirExists = existsSync(installDir);

    if (!installDirExists) {
      console.error('[marvin] Marvin is not installed. Run the installer first:');
      console.error('[marvin]   bash install.sh');
      process.exit(1);
    }

    // Fetch latest release from GitHub
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    let releaseJson: string;
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) {
        console.error('[marvin] Could not fetch latest release. Is this your first update?');
        console.error('[marvin]   Create a GitHub release with a .tar.gz asset, then retry.');
        process.exit(1);
      }
      releaseJson = await res.text();
    } catch (err) {
      console.error('[marvin] Network error fetching GitHub API:', (err as Error).message);
      process.exit(1);
    }

    const release = JSON.parse(releaseJson) as { tag_name: string; assets: { browser_download_url: string }[] };
    const latestTag = release.tag_name;

    // Get current version from package.json
    const pkgPath = join(installDir, 'package.json');
    let currentVersion = '0.0.0';
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      currentVersion = pkg.version || '0.0.0';
    }

    if (latestTag === `v${currentVersion}`) {
      console.log('[marvin] Already up to date (v' + currentVersion + ').');
      return;
    }

    console.log('[marvin] Update available:', latestTag, '(current: v' + currentVersion + ')');

    // Find .tar.gz asset
    const asset = release.assets?.find(a => a.browser_download_url.endsWith('.tar.gz'));
    if (!asset) {
      console.error('[marvin] No .tar.gz asset found in latest release.');
      process.exit(1);
    }

    console.log('[marvin] Downloading update...');
    const tmpFile = join('/tmp', `marvin-${latestTag}.tar.gz`);
    const assetRes = await fetch(asset.browser_download_url);
    if (!assetRes.ok) {
      console.error('[marvin] Download failed:', assetRes.status);
      process.exit(1);
    }

    // Write archive to temp file
    const arrayBuffer = await assetRes.arrayBuffer();
    const nodeBuffer = Buffer.from(new Uint8Array(arrayBuffer));
    writeFileSync(tmpFile, nodeBuffer);

    // Extract over existing install
    const { execSync } = await import('node:child_process');
    execSync(`rm -rf ${installDir}`, { stdio: 'inherit' });
    execSync(`mkdir -p ${installDir}`, { stdio: 'inherit' });
    execSync(`tar -xzf ${tmpFile} -C ${installDir} --strip-components=1`, { stdio: 'inherit' });
    execSync(`rm -f ${tmpFile}`, { stdio: 'inherit' });

    // Reinstall dependencies
    console.log('[marvin] Reinstalling dependencies...');
    execSync(`cd ${installDir} && bun install`, { stdio: 'inherit' });

    // Restart service
    console.log('[marvin] Restarting service...');
    execSync(`systemctl --user restart marvin`, { stdio: 'inherit' });

    console.log('[marvin] Updated to', latestTag);
  }

  async execStatus(): Promise<void> {
    console.log('[marvin]', 'Client.execStatus');

    // service status
    try {
      const status = execSync(`systemctl --user status marvin 2>&1 || true`, { encoding: 'utf8' });
      console.log(status);
    } catch {
      console.log('[marvin] Service is not running.');
    }

    // TODO: replace health w/ GET status

    // health check
    const port = this.ctx!.config?.settings?.port || 7331;
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
  }

  // send reload command to server
  async execReload() {
    console.log('[marvin]', 'Client.execReload');

    const url = new URL(`http://localhost:${this.ctx!.config.settings.port}/`);
    url.pathname = '/reload';
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Client.execReload: Error ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }
}
