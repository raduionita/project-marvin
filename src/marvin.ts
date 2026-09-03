#!/usr/bin/env bun

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { configDotenv } from 'dotenv';

import {  Command, Config } from './types.js';
import * as constants from './constants.js';
import { mergeConfig, tryJsonParse } from './helpers/index.js';
import { listCommands } from './commands';
import logger, { setLoggerMode } from './logger.js';
import Engine from './engine.js';

await (new class Marvin {
  // shared logger (default-exported singleton from ./logger.js); see
  // `setLoggerMode` for the daemon prefix/stripTags mode
  engine : Engine = new Engine();
  command: Command | undefined = undefined;

  async exec() {
    logger.debug('[Marvin.exec]');
    
    this.loadFlags();
    this.loadProcess();
    this.loadConfig();
          
    return await this.execCommand();
  }

  loadProcess() {
    logger.debug('[Marvin.loadProcess]');

    process.on('beforeExit', async (code) => {
      logger.debug('[Marvin.loadProcess]', 'beforeExit', `${code}`);
      await this.drop();
    });

    // process exit (graceful shutdown = stopServer)
    process.on('exit', async (code) => {
      logger.debug('[Marvin.loadProcess]', 'exit', `${code}`);
    });

    // SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      logger.info('[Marvin.loadProcess]', 'SIGINT', 'exiting...');
      // goto process.on('exit') instead
      await this.drop();
      process.exit(0);
    });

    // SIGTERM (kill)
    process.on('SIGTERM', async () => {
      logger.info('[Marvin.loadProcess]', 'SIGTERM', 'exiting...');
      // goto process.on('exit')
      await this.drop();
      process.exit(0);
    });

    // unhandled rejection from promise
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('[Marvin.loadProcess]', 'unhandledRejection:', promise, 'reason:', reason);
      // TODO: decide if the rejection should trigger a shutdown
    });

    // uncaught exception
    process.on('uncaughtException', (err) => {
      logger.error('[Marvin.loadProcess]', 'uncaughtException:', err);
      // TODO: decide if the exception should trigger a shutdown
    });
  }  

  loadConfig(config?: Config | undefined) {
    logger.debug('[Marvin.loadConfig]');
    if (config) {
      this.engine.config = mergeConfig(constants.DEFAULT_CONFIG as Config, config);
      return;
    }

    configDotenv({ encoding: 'utf8', quiet: true, path: ['.env', '.env.local'] });

    // at this stage marvin.json MUST exist, but just in case
    const cpath = join(this.engine.work, 'marvin.json');
    if (!existsSync(cpath)) {
      logger.warn('[Marvin.loadConfig]', 'Config file not found:', cpath, 'using default config');
      return;
    }

    const data = readFileSync(cpath, 'utf8');

    this.engine.config = mergeConfig(constants.DEFAULT_CONFIG as Config, tryJsonParse(data) || {});
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

      // --logLevel <level> / --log-level <level> or =<level>: set MARVIN_LOG_LEVEL
      // (value is lowercased so DEBUG == debug, as only lowercase levels are valid)
      if (arg === '--logLevel' || arg === '--log-level') {
        const level = process.argv[i + 1];
        if (level !== undefined) {
          process.env.MARVIN_LOG_LEVEL = level.toLowerCase();
          i++;
        }
        continue;
      }
      if (arg.startsWith('--logLevel=') || arg.startsWith('--log-level=')) {
        const eq = arg.indexOf('=');
        process.env.MARVIN_LOG_LEVEL = arg.slice(eq + 1).toLowerCase();
        continue;
      }

      // --useLogPrefix: prefix log lines with [LEVEL] and keep [ClassName.method] tags
      if (arg === '--useLogPrefix') {
        setLoggerMode({ prefix: true, stripTags: false });
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
    logger.debug('[Marvin.execCommand]');

    const args = process.argv.slice(2);
    let   cmd  = args[0] || 'help';
    const cmds = listCommands(this.engine);

    if (!cmds.includes(cmd)) {
      logger.warn('[Marvin.execCommand]', 'unknown command:', cmd, 'available commands:', cmds.join(', '));
      cmd = 'help';
    }

    try {
      const Module = await import(`./commands/${cmd}.ts`);
      const Class = Module.default;
      // must be a Command class
      if (!Class || !(Class.prototype instanceof Command)) {
        logger.warn('[Marvin.execCommand]', `${cmd} does not export a Command class, exiting`);
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
        logger.debug('[Marvin.execCommand]', 'done');
      } else {
        logger.debug('[Marvin.execCommand]', 'deamon, keep running');
      }
    } catch (err) {
      logger.error('[Marvin.execCommand]', `failed to load ${cmd}:`, err);
    }
  }

  async drop() {
    if (!this.command) {
      return;
    }

    logger.debug('[Marvin.drop]');

    await this.command.drop();

    this.command = undefined;
  }
}).exec();
