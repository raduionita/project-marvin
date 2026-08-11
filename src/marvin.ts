#!/usr/bin/env bun

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { configDotenv } from 'dotenv';

import {  Command, Config } from './types.js';
import * as constants from './constants.js';
import { tryJsonParse } from './helpers.js';
import { listCommands } from './commands/index.js';
import { loadConsole, enablePrefix } from './logger.js';
import Engine from './engine.js';

await (new class Marvin {
  engine : Engine = new Engine();
  command: Command | undefined = undefined;

  async exec() {
    
    this.loadFlags();
    
    loadConsole();

    console.debug('[Marvin.exec]');

    this.loadProcess();
    this.loadConfig();
          
    return await this.execCommand();
  }

  loadProcess() {
    console.debug('[Marvin.loadProcess]');

    process.on('beforeExit', async (code) => {
      console.debug('[Marvin.loadProcess]', 'beforeExit', `${code}`);
      await this.drop();
    });

    // process exit (graceful shutdown = stopServer)
    process.on('exit', async (code) => {
      console.debug('[Marvin.loadProcess]', 'exit', `${code}`);
    });

    // SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      console.info('[Marvin.loadProcess]', 'SIGINT', 'exiting...');
      // goto process.on('exit') instead
      await this.drop();
      process.exit(0);
    });

    // SIGTERM (kill)
    process.on('SIGTERM', async () => {
      console.info('[Marvin.loadProcess]', 'SIGTERM', 'exiting...');
      // goto process.on('exit')
      await this.drop();
      process.exit(0);
    });

    // unhandled rejection from promise
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[Marvin.loadProcess]', 'unhandledRejection:', promise, 'reason:', reason);
      // TODO: decide if the rejection should trigger a shutdown
    });

    // uncaught exception
    process.on('uncaughtException', (err) => {
      console.error('[Marvin.loadProcess]', 'uncaughtException:', err);
      // TODO: decide if the exception should trigger a shutdown
    });
  }  

  loadConfig(config?: Config | undefined) {
    console.debug('[Marvin.loadConfig]');
    if (config) {
      this.engine.config = config;
      return;
    }

    configDotenv({ encoding: 'utf8', quiet: true, path: ['.env', '.env.local'] });

    config = {} as Config;

    // at this stage marvin.json MUST exist, but just in case
    const cpath = join(this.engine.work, 'marvin.json');
    if (!existsSync(cpath)) {
      console.warn('[Marvin.loadConfig]', 'Config file not found:', cpath, 'using default config');
      return;
    }

    const data = readFileSync(cpath, 'utf8');

    this.engine.config = tryJsonParse(data)!;
  }

  loadFlags() {
    const rest: string[] = [];
    let help = false;

    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === undefined) {
        continue;
      }

      // --help: run the help command
      if (arg === '--help') {
        help = true;
        continue;
      }

      // --logLevel <level> or --logLevel=<level>: set MARVIN_LOG_LEVEL
      if (arg === '--logLevel') {
        const level = process.argv[i + 1];
        if (level !== undefined) {
          process.env.MARVIN_LOG_LEVEL = level;
          i++;
        }
        continue;
      }
      if (arg.startsWith('--logLevel=')) {
        process.env.MARVIN_LOG_LEVEL = arg.slice('--logLevel='.length);
        continue;
      }

      // --useLogPrefix: prefix log lines with [LEVEL]
      if (arg === '--useLogPrefix') {
        enablePrefix(true);
        continue;
      }

      rest.push(arg);
    }

    process.argv = [process.argv[0] ?? 'bun', process.argv[1] ?? 'marvin', ...rest];
    if (help) {
      process.argv[2] = 'help';
    }
  }

  async execCommand() {
    console.debug('[Marvin.execCommand]');

    const args = process.argv.slice(2);
    let   cmd  = args[0] || 'help';
    const cmds = listCommands(this.engine).map(f => f.replace('.ts', ''));

    if (!cmds.includes(cmd)) {
      console.warn('[Marvin.execCommand]', 'unknown command:', cmd, 'available commands:', cmds.join(', '));
      cmd = 'help';
    }

    try {
      const Module = await import(`./commands/${cmd}.ts`);
      const Class = Module.default;
      // must be a Command class
      if (!Class || !(Class.prototype instanceof Command)) {
        console.warn('[Marvin.execCommand]', `${cmd} does not export a Command class, exiting`);
        return;
      }
      // create command and load/run it
      this.command = new Class(this.engine, args.slice(1));
      if (!this.command) {
        process.exit(1);
      }
      
      await this.command.exec();

      // if !deamon, exit
      if (!this.command.deamon) {
        await this.drop();
        console.debug('[Marvin.execCommand]', 'done');
      } else {
        console.debug('[Marvin.execCommand]', 'deamon, keep running');
      }
    } catch (err) {
      console.error('[Marvin.execCommand]', `failed to load ${cmd}:`, err);
    }
  }

  async drop() {
    if (!this.command) {
      return;
    }

    console.debug('[Marvin.drop]');

    await this.command.drop();

    this.command = undefined;
  }
}).exec();
