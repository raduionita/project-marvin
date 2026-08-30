import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import { Mcp, testMcp, specMcp } from '../mcp.js';
import { tryJsonParse } from '../helpers/index.js';
import { editor, confirm, input, select } from '../terminal.js';
import logger from '../logger.js';

// `marvin mcps [command]` list, add, edit, info, drop mcp connectors
export default class McpsCommand extends Command {
  async exec() {
    logger.debug('[McpsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        logger.warn('[McpsCommand.exec]', 'unknown command: mcps', cmd);
      case 'help':
        await this.execHelp();
      break;
      // list configured mcps
      case 'list':
        await this.execList();
      break;
      // add an mcp from a pasted json snippet
      case 'add':
        await this.execAdd();
      break;
      // edit an mcp (re-paste the snippet)
      case 'edit':
        await this.execEdit();
      break;
      // connect and list the server's tools
      case 'info':
        await this.execInfo();
      break;
      // drop an mcp
      case 'drop':
        await this.execDrop();
      break;
    }
  }

  // `marvin mcps help`
  async execHelp() {
    logger.log('usage: marvin mcps [command]');
    logger.log('commands:');
    logger.log('  help              ', 'show this help');
    logger.log('  list              ', 'list configured mcps');
    logger.log('  add               ', 'add an mcp (asks for the id, then paste the json snippet)');
    logger.log('  edit <name> [file]', 'edit an mcp (paste the new json snippet)');
    logger.log('  info <name>       ', 'connect and list the server tools');
    logger.log('  drop <name>       ', 'drop an mcp');
  }

  // `marvin mcps list`
  async execList() {
    logger.debug('[McpsCommand.execList]');
    logger.log('mcps:');
    const mcps = this.engine.config.mcps || {};
    if (Object.keys(mcps).length === 0) {
      logger.log('  (none)');
    }
    
    for (const [id, config] of Object.entries(mcps)) {
      logger.log(`  ${id}`);
      logger.log('  - enabled:', config.enabled);
      logger.log('  - command:', [config.command, ...(config.args || [])].join(' '));
      for (const [key, value] of Object.entries(config.env || {})) {
        logger.log(`  - env.${key}:`, value);
      }
    }
  }

  // `marvin mcps add`
  async execAdd() {
    logger.debug('[McpsCommand.execAdd]', 'adding an mcp...');

    // ask for the mcp name
    const name = this.args[1] || await input({
      message: 'Enter mcp name (e.g. gloobeam):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid name (use a-z, 0-9, _ and -)',
    });
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      logger.error('[McpsCommand.execAdd]', 'invalid name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // must NOT exist
    if (this.engine.config.mcps?.[name]) {
      logger.error('[McpsCommand.execAdd]', `mcp "${name}" is already configured`);
      return;
    }

    // ask for the multi-line json snippet (edited in $EDITOR)
    const text = await editor({ message: 'Paste the mcp json snippet:', default: '', postfix: '.json' });
    const json = tryJsonParse(text.trim());
    if (!json || typeof json !== 'object' || !Object.keys(json).length) {
      logger.error('[McpsCommand.execAdd]', 'invalid json snippet');
      return;
    }

    const conf = specMcp(json);
    if (!conf) {
      logger.error('[McpsCommand.execAdd]', 'invalid mcp snippet (missing "command" or bad shape)');
      return;
    }

    // show the specs
    logger.log(conf);
    logger.log('testing connection...');

    // verify connectivity before saving (spawn + initialize + listTools)
    const ok = await testMcp(this.engine, name, conf);
    if (!ok) {
      const saveAnyway = await confirm({ message: 'Connection failed. Save anyway?', default: false });
      // stop early
      if (!saveAnyway) {
        logger.info('[McpsCommand.execAdd]', 'aborted, nothing saved');
        return;
      }
    }

    // register the mcp in config (tools now load lazily via load_tools)
    const mcps = this.engine.config.mcps || {};
    conf.enabled = true;
    mcps[name] = conf;
    this.engine.config.mcps = mcps;

    // save config
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    
    logger.info(`config updated: ${cpath}`);
    logger.info('mcp added');
  }

  // `marvin mcps edit <name> [file]`
  async execEdit() {
    logger.debug('[McpsCommand.execEdit]');

    const mcps = Object.keys(this.engine.config.mcps || {});
    if (!mcps.length) {
      logger.warn('[McpsCommand.execEdit]', 'no mcps configured');
      return;
    }
    const pname = this.args[1] || await select({
      message: 'Select mcp to edit:',
      choices: mcps.map(id => ({ name: id, value: id })),
    });

    // must exist
    const current = this.engine.config.mcps[pname];
    if (!current) {
      logger.error('[McpsCommand.execEdit]', `mcp "${pname}" not found in config`);
      return;
    }

    const text = await editor({ message: 'Paste the mcp json snippet:', default: '', postfix: '.json' });
    const json = tryJsonParse<any>(text);
    if (!json || typeof json !== 'object' || !Object.keys(json).length) {
      logger.error('[McpsCommand.execEdit]', 'invalid json snippet');
      return;
    }

    const config = specMcp(json);
    if (!config) {
      logger.error('[McpsCommand.execEdit]', 'invalid mcp snippet (missing "command" or bad shape)');
      return;
    }

    // replace the spawn spec, keeping the previous enabled flag unless set
    if (config.enabled === undefined) config.enabled = current.enabled;

    const ok = await testMcp(this.engine, pname, config);
    if (!ok) {
      const saveAnyway = await confirm({ message: 'Connection failed. Save anyway?', default: false });
      if (!saveAnyway) {
        logger.info('[McpsCommand.execEdit]', 'aborted, nothing saved');
        return;
      }
    }

    this.engine.config.mcps![pname] = config;

    // save config
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    
    logger.info(`config updated: ${cpath}`);
    logger.info('mcp updated');
  }

  // `marvin mcps info <name>`: connect and list the server's tools
  async execInfo() {
    logger.debug('[McpsCommand.execInfo]');

    const mcps = Object.keys(this.engine.config.mcps || {});
    if (!mcps.length) {
      logger.warn('[McpsCommand.execInfo]', 'no mcps configured');
      return;
    }
    const pname = this.args[1] || await select({
      message: 'Select mcp:',
      choices: mcps.map(id => ({ name: id, value: id })),
    });

    const config = this.engine.config.mcps?.[pname];
    if (!config) {
      logger.error('[McpsCommand.execInfo]', `mcp "${pname}" not found in config`);
      return;
    }

    const client = new Mcp(this.engine, pname, config);
    try {
      logger.log(`getting ${pname} mcp info...`);
      await client.load();

      logger.log(`mcp "${pname}" (${[config.command, ...(config.args || [])].join(' ')}):`);
      if (!Object.keys(client.tools).length) {
        logger.log('  (no tools)');
      }
      for (const tool of Object.values(client.tools)) {
        logger.log(`  ${tool.name}`);
        if (tool.description) logger.log('  - description:', tool.description);
        logger.log('  - parameters:', JSON.stringify(tool.inputSchema));
      }
    } catch (err) {
      logger.error('[McpsCommand.execInfo]', `failed to connect to "${pname}":`, err);
    } finally {
      await client.drop();
    }
  }

  // `marvin mcps drop <name>`
  async execDrop() {
    logger.debug('[McpsCommand.execDrop]');

    const mcps = Object.keys(this.engine.config.mcps || {});
    if (!mcps.length) {
      logger.warn('[McpsCommand.execDrop]', 'no mcps configured');
      return;
    }

    const pname = this.args[1] || await select({
      message: 'Select mcp to drop:',
      choices: mcps.map(id => ({ name: id, value: id })),
    });

    // should exist
    if (!this.engine.config.mcps?.[pname]) {
      logger.warn('[McpsCommand.execDrop]', `mcp "${pname}" not found in config`);
      return;
    }

    // disconnect and remove the mcp from the engine if loaded
    await this.engine.dropMcp(pname);

    // remove the mcp from the config
    delete this.engine.config.mcps![pname];

    // save config
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

    logger.info(`config updated: ${cpath}`);
    logger.info('mcp dropped');
  }
}
