#!/usr/bin/env bun

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { configDotenv } from 'dotenv';

import { Context, Command, Config } from './types.js';
import * as constants from './constants.js';
import { tryJsonParse } from './helpers.js';
import { listCommands } from './commands/index.js';
import { homedir } from 'os';

console.log(process.env.HOME);

await (new class App extends Command {
  cmd: Command = this.ctx.command; // dummy

  async load() {
    console.debug('[App.load]');
          this.loadProcess();
          this.loadConfig();
          this.loadFlags();
    await this.loadCommand();
  }

  loadProcess() {
    console.debug('[App.loadProcess]');

    // process exit (graceful shutdown = stopServer)
    process.on('exit', async (code) => {
      console.log('[App.loadProcess]', 'exit', `${code}`);
      // cleanup
      await this.drop();
    });

    // SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      console.log('[App.loadProcess]', 'SIGINT', 'exiting...');
      // goto process.on('exit') instead
      process.exit(0);
    });

    // SIGTERM (kill)
    process.on('SIGTERM', () => {
      console.log('[App.loadProcess]', 'SIGTERM', 'exiting...');
      // goto process.on('exit')
      process.exit(0);
    });

    // unhandled rejection from promise
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[App.loadProcess]', 'unhandledRejection:', promise, 'reason:', reason);
      // TODO: decide if the rejection should trigger a shutdown
    });

    // uncaught exception
    process.on('uncaughtException', (err) => {
      console.error('[App.loadProcess]', 'uncaughtException:', err);
      // TODO: decide if the exception should trigger a shutdown
    });
  }  

  loadConfig(config?: Config | undefined) {
    console.debug('[App.loadConfig]');
    if (config) {
      this.ctx.config = config;
      return;
    }

    configDotenv({ encoding: 'utf8', quiet: true, path: ['.env', '.env.local'] });

    config = {} as Config;

    // at this stage marvin.json MUST exist, but just in case
    const cpath = join(this.ctx.home, 'marvin.json');
    if (!existsSync(cpath)) {
      console.warn('[App.loadConfig]', 'Config file not found:', cpath, 'using default config');
      this.ctx.config = constants.DEFAULT_CONFIG as Config;
      return;
    }

    const data = readFileSync(cpath, 'utf8');

    this.ctx.config = tryJsonParse(data)!;
  }

  loadFlags() {
    console.debug('[App.loadFlags]');
    // const args = process.argv.slice(2);
  }

  async loadCommand() {
    console.debug('[App.loadCommand]');

    const args = process.argv.slice(2);
    let   cmd  = args[0] || 'help';
    const cmds = listCommands(this.ctx).map(f => f.replace('.ts', ''));

    if (!cmds.includes(cmd)) {
      console.warn('[App.loadCommand]', 'unknown command:', cmd, 'available commands:', cmds.join(', '));
      cmd = 'help';
    }

    try {
      const Module = await import(`./commands/${cmd}.ts`);
      const Class = Module.default;
      // must be a Command class
      if (!Class || !(Class.prototype instanceof Command)) {
        console.warn('[App.loadCommand]', `${cmd} does not export a Command class, exiting`);
        return;
      }
      // create command and load/run it
      this.cmd = new Class(this.ctx);
      this.cmd.load();
    } catch (err) {
      console.error('[App.loadCommand]', `failed to load ${cmd}:`, err);
    }
  }

  async drop() {
    console.debug('[App.drop]');

    await this.cmd.drop();
  }
}(new Context())); //.load();
