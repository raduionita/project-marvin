#!/usr/bin/env bun

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { configDotenv } from 'dotenv';

import { Context, Command, Config } from './types.js';
import * as constants from './constants.js';
import { tryJsonParse } from './helpers.js';
import { listCommands } from './commands/index.js';

await (new class App {
  ctx: Context = new Context();
  cmd: Command = this.ctx.command; // dummy

  async init() {
    console.log('[marvin]', 'App.init');

          this.initHandlers();
          this.initConfig();
          this.initFlags();
    await this.initCommands();
  }

  initHandlers() {
    // process exit (graceful shutdown = stopServer)
    process.on('exit', async (code) => {
      console.log('[marvin]', 'App.initHandlers', `process.exit(${code})`);
      // cleanup
      await this.drop();
    });

    // SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      console.log('[marvin]', 'App.initHandlers', 'SIGINT');
      // goto process.on('exit') instead
      process.exit(0);
    });

    // SIGTERM (kill)
    process.on('SIGTERM', () => {
      console.log('[marvin]', 'App.initHandlers', 'SIGTERM');
      // goto process.on('exit')
      process.exit(0);
    });

    // unhandled rejection from promise
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[marvin]', 'App.initHandlers', 'unhandledRejection:', promise, 'reason:', reason);
      // TODO: decide if the rejection should trigger a shutdown
    });

    // uncaught exception
    process.on('uncaughtException', (err) => {
      console.error('[marvin]', 'App.initHandlers', 'uncaughtException:', err);
      // TODO: decide if the exception should trigger a shutdown
    });
  }  

  initConfig(config?: Config | undefined) {
    console.log('[marvin]', 'App.initConfig', config !== undefined);
    if (config) {
      this.ctx.config = config;
      return;
    }

    configDotenv({ encoding: 'utf8', quiet: true, path: ['.env', '.env.local'] });

    const path = join(this.ctx.home, 'marvin.json');

    config = {} as Config;

    // at this stage marvin.json MUST exist, but just in case
    if (!existsSync(path)) {
      console.warn('[marvin]', 'App.initConfig', 'Config file not found:', path);
      this.ctx.config = constants.DEFAULT_CONFIG as Config;
      return;
    }

    const data = readFileSync(path, 'utf8');
    config = tryJsonParse(data);

    this.ctx.config = config!;
  }

  initFlags() {
    console.debug('[marvin]', 'App.initFlags');
    // const args = process.argv.slice(2);
  }

  async initCommands() {
    console.debug('[marvin]', 'App.initCommands');

    const args = process.argv.slice(2);
    let   arg = args[0] || 'help';
    const cmds = listCommands(this.ctx).map(f => f.replace('.ts', ''));

    if (!cmds.includes(arg)) {
      console.warn('[marvin]', 'unknown command:', arg, 'available commands:', cmds.join(', '));
      arg = 'help';
    }

    try {
      const Module = await import('./commands/help.js');
      const Class = Module.default;
      // must be a Command class
      if (!Class || !(Class.prototype instanceof Command)) {
        console.warn('[marvin]', 'App.initCommands', `${arg} does not export a Command class, exiting`);
        return;
      }
      // create command and init/run it
      this.cmd = new Class(this.ctx);
      this.cmd.init();
    } catch (err) {
      console.error('[marvin]', 'App.initCommands', `failed to load ${arg}:`, err);
    }
  }

  async drop() {
    console.debug('[marvin]', 'App.drop');

    await this.cmd.drop();
  }
}).init();
