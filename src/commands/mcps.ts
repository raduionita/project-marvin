import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import { Mcp, testMcp, specMcp } from '../mcp.js';
import { tryJsonParse } from '../helpers/index.js';
import { editor, confirm, input, select } from '../terminal.js';

// `marvin mcps [command]` list, add, edit, info, drop mcp connectors
export default class McpsCommand extends Command {
  async exec() {
    this.logger.debug('[McpsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        this.logger.warn('[McpsCommand.exec]', 'unknown command: mcps', cmd);
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
    this.logger.log('usage: marvin mcps [command]');
    this.logger.log('commands:');
    this.logger.log('  help              ', 'show this help');
    this.logger.log('  list              ', 'list configured mcps');
    this.logger.log('  add               ', 'add an mcp (asks for the id, then paste the json snippet)');
    this.logger.log('  edit <name> [file]', 'edit an mcp (paste the new json snippet)');
    this.logger.log('  info <name>       ', 'connect and list the server tools');
    this.logger.log('  drop <name>       ', 'drop an mcp');
  }

  // `marvin mcps list`
  async execList() {
    this.logger.debug('[McpsCommand.execList]');
    this.logger.log('mcps:');
    const mcps = this.engine.config.mcps || {};
    if (Object.keys(mcps).length === 0) {
      this.logger.log('  (none)');
    }
    
    for (const [id, config] of Object.entries(mcps)) {
      this.logger.log(`  ${id}`);
      this.logger.log('  - enabled:', config.enabled);
      this.logger.log('  - command:', [config.command, ...(config.args || [])].join(' '));
      for (const [key, value] of Object.entries(config.env || {})) {
        this.logger.log(`  - env.${key}:`, value);
      }
    }
  }

  // `marvin mcps add`
  async execAdd() {
    this.logger.debug('[McpsCommand.execAdd]', 'adding an mcp...');

    // ask for the mcp name
    const name = this.args[1] || await input({
      message: 'Enter mcp name (e.g. gloobeam):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid name (use a-z, 0-9, _ and -)',
    });
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.logger.error('[McpsCommand.execAdd]', 'invalid name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // must NOT exist
    if (this.engine.config.mcps?.[name]) {
      this.logger.error('[McpsCommand.execAdd]', `mcp "${name}" is already configured`);
      return;
    }

    // ask for the multi-line json snippet (edited in $EDITOR)
    const text = await editor({ message: 'Paste the mcp json snippet:', default: '', postfix: '.json' });
    const json = tryJsonParse(text.trim());
    if (!json || typeof json !== 'object' || !Object.keys(json).length) {
      this.logger.error('[McpsCommand.execAdd]', 'invalid json snippet');
      return;
    }

    const conf = specMcp(json);
    if (!conf) {
      this.logger.error('[McpsCommand.execAdd]', 'invalid mcp snippet (missing "command" or bad shape)');
      return;
    }

    // show the specs
    this.logger.log(conf);
    this.logger.log('testing connection...');

    // verify connectivity before saving (spawn + initialize + listTools)
    const ok = await testMcp(this.engine, name, conf);
    if (!ok) {
      const saveAnyway = await confirm({ message: 'Connection failed. Save anyway?', default: false });
      // stop early
      if (!saveAnyway) {
        this.logger.info('[McpsCommand.execAdd]', 'aborted, nothing saved');
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
    
    this.logger.info(`config updated: ${cpath}`);
    this.logger.info('mcp added');
  }

  // `marvin mcps edit <name> [file]`
  async execEdit() {
    this.logger.debug('[McpsCommand.execEdit]');

    const mcps = Object.keys(this.engine.config.mcps || {});
    if (!mcps.length) {
      this.logger.warn('[McpsCommand.execEdit]', 'no mcps configured');
      return;
    }
    const pname = this.args[1] || await select({
      message: 'Select mcp to edit:',
      choices: mcps.map(id => ({ name: id, value: id })),
    });

    // must exist
    const current = this.engine.config.mcps[pname];
    if (!current) {
      this.logger.error('[McpsCommand.execEdit]', `mcp "${pname}" not found in config`);
      return;
    }

    const text = await editor({ message: 'Paste the mcp json snippet:', default: '', postfix: '.json' });
    const json = tryJsonParse<any>(text);
    if (!json || typeof json !== 'object' || !Object.keys(json).length) {
      this.logger.error('[McpsCommand.execEdit]', 'invalid json snippet');
      return;
    }

    const config = specMcp(json);
    if (!config) {
      this.logger.error('[McpsCommand.execEdit]', 'invalid mcp snippet (missing "command" or bad shape)');
      return;
    }

    // replace the spawn spec, keeping the previous enabled flag unless set
    if (config.enabled === undefined) config.enabled = current.enabled;

    const ok = await testMcp(this.engine, pname, config);
    if (!ok) {
      const saveAnyway = await confirm({ message: 'Connection failed. Save anyway?', default: false });
      if (!saveAnyway) {
        this.logger.info('[McpsCommand.execEdit]', 'aborted, nothing saved');
        return;
      }
    }

    this.engine.config.mcps![pname] = config;

    // save config
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    
    this.logger.info(`config updated: ${cpath}`);
    this.logger.info('mcp updated');
  }

  // `marvin mcps info <name>`: connect and list the server's tools
  async execInfo() {
    this.logger.debug('[McpsCommand.execInfo]');

    const mcps = Object.keys(this.engine.config.mcps || {});
    if (!mcps.length) {
      this.logger.warn('[McpsCommand.execInfo]', 'no mcps configured');
      return;
    }
    const pname = this.args[1] || await select({
      message: 'Select mcp:',
      choices: mcps.map(id => ({ name: id, value: id })),
    });

    const config = this.engine.config.mcps?.[pname];
    if (!config) {
      this.logger.error('[McpsCommand.execInfo]', `mcp "${pname}" not found in config`);
      return;
    }

    const client = new Mcp(this.engine, pname, config);
    try {
      this.logger.log(`getting ${pname} mcp info...`);
      await client.load();

      this.logger.log(`mcp "${pname}" (${[config.command, ...(config.args || [])].join(' ')}):`);
      if (!Object.keys(client.tools).length) {
        this.logger.log('  (no tools)');
      }
      for (const tool of Object.values(client.tools)) {
        this.logger.log(`  ${tool.name}`);
        if (tool.description) this.logger.log('  - description:', tool.description);
        this.logger.log('  - parameters:', JSON.stringify(tool.inputSchema));
      }
    } catch (err) {
      this.logger.error('[McpsCommand.execInfo]', `failed to connect to "${pname}":`, err);
    } finally {
      await client.drop();
    }
  }

  // `marvin mcps drop <name>`
  async execDrop() {
    this.logger.debug('[McpsCommand.execDrop]');

    const mcps = Object.keys(this.engine.config.mcps || {});
    if (!mcps.length) {
      this.logger.warn('[McpsCommand.execDrop]', 'no mcps configured');
      return;
    }

    const pname = this.args[1] || await select({
      message: 'Select mcp to drop:',
      choices: mcps.map(id => ({ name: id, value: id })),
    });

    // should exist
    if (!this.engine.config.mcps?.[pname]) {
      this.logger.warn('[McpsCommand.execDrop]', `mcp "${pname}" not found in config`);
      return;
    }

    // disconnect and remove the mcp from the engine if loaded
    await this.engine.dropMcp(pname);

    // remove the mcp from the config
    delete this.engine.config.mcps![pname];

    // save config
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

    this.logger.info(`config updated: ${cpath}`);
    this.logger.info('mcp dropped');
  }
}
