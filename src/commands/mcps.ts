import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command, Config } from "../types";
import { Mcp, testMcp } from '../mcp.js';
import { tryJsonParse } from '../helpers.js';
import { multiline, checkbox, confirm, input } from '../terminal.js';

// unwrap common paste formats down to the server spec, then validate it:
// - claude-style wrapper: { "mcpServers": { "<name>": {...} } }
// - bare named server:    { "<name>": { "command": ... } }
// - direct spec:          { "command": ..., "args": [...], "env": {...} }
// returns the spawn config, or null when the snippet is invalid
export function specMcp(json: {[key:string]:any}): Config['mcps'][string] | null {
  let spec: { [key: string]: any } = json;
  if (json && typeof json === 'object' && !Array.isArray(json) && json.mcpServers && typeof json.mcpServers === 'object') {
    const entries = Object.entries(json.mcpServers);
    if (entries.length) spec = entries[0]![1] as { [key: string]: any };
  } else if (json && typeof json === 'object' && !Array.isArray(json)) {
    const keys = Object.keys(json);
    if (keys.length === 1) {
      const value = (json as { [key: string]: any })[keys[0]!];
      if (value && typeof value === 'object' && !Array.isArray(value) && value.command) spec = value;
    }
  }

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  if (typeof spec.command !== 'string' || !spec.command.trim()) return null;
  if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some((a: any) => typeof a !== 'string'))) return null;
  if (spec.env !== undefined && (!spec.env || typeof spec.env !== 'object' || Array.isArray(spec.env) || Object.values(spec.env).some((v: any) => typeof v !== 'string'))) return null;

  const config: Config['mcps'][string] = {
    ...(spec.enabled === undefined ? {} : { enabled: !!spec.enabled }),
    command: spec.command.trim(),
    args: spec.args || [],
    ...(spec.env ? { env: spec.env } : {}),
  };
  return config;
}

// `marvin mcps [command] [--dry]` list, add, edit, info, drop mcp connectors
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
    const name = await input({
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

    // ask for the multi-line json snippet
    const text = await multiline('Paste the mcp json snippet (end with an empty line):');
    const json = tryJsonParse(text);
    if (!json || typeof json !== 'object' || !Object.keys(json).length) {
      this.logger.error('[McpsCommand.execAdd]', 'invalid json snippet');
      return;
    }

    const config = specMcp(json);
    if (!config) {
      this.logger.error('[McpsCommand.execAdd]', 'invalid mcp snippet (missing "command" or bad shape)');
      return;
    }

    // verify connectivity before saving (spawn + initialize + listTools)
    const ok = await testMcp(this.engine, name, config);
    if (!ok) {
      const saveAnyway = await confirm({ message: 'Connection failed. Save anyway?', default: false });
      // stop early
      if (!saveAnyway) {
        this.logger.info('[McpsCommand.execAdd]', 'aborted, nothing saved');
        return;
      }
    }

    // ask which tasks to link this mcp to (its tools become task tools)
    const taskIds = Object.keys(this.engine.config.tasks || {});
    if (taskIds.length) {
      const pickedTasks = await checkbox({
        message: `Link "${name}" to tasks (space to toggle, enter to confirm):`,
        choices: taskIds.map(taskId => ({ name: taskId, value: taskId })),
      });
      for (const taskId of pickedTasks) {
        const task = this.engine.config.tasks?.[taskId];
        if (!task) {
          this.logger.warn('[McpsCommand.execAdd]', `unknown task "${taskId}", skipping`);
          continue;
        }
        task.mcps = [...new Set([...(task.mcps || []), name])];
      }
    }

    // register the mcp in config
    const mcps = this.engine.config.mcps || {};
    mcps[name] = config;
    this.engine.config.mcps = mcps;

    // save config
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      this.logger.info('[dry]', `would persist: config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
      this.logger.info(`config updated: ${cpath}`);
    }

    this.logger.info('mcp added');
  }

  // `marvin mcps edit <name> [file]`
  async execEdit() {
    this.logger.debug('[McpsCommand.execEdit]');

    const pname = this.args[1] || await input({
      message: 'Enter mcp name (e.g. gloobeam):',
      required: true,
    });

    // must exist
    const current = this.engine.config.mcps[pname];
    if (!current) {
      this.logger.error('[McpsCommand.execEdit]', `mcp "${pname}" not found in config`);
      return;
    }

    const text = await multiline('Paste the mcp json snippet (end with an empty line):');
    if (text === null) return;

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
    if (this.engine.isDry) {
      this.logger.info('[dry]', `would persist: config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
      this.logger.info(`config updated: ${cpath}`);
    }

    this.logger.info('mcp updated');
  }

  // `marvin mcps info <name>`: connect and list the server's tools
  async execInfo() {
    this.logger.debug('[McpsCommand.execInfo]');

    const pname = this.args[1] || await input({ message: 'Enter mcp name (e.g. gloobeam):' });
    if (!pname) {
      this.logger.warn('[McpsCommand.execInfo]', 'usage: marvin mcps info <name>');
      return;
    }

    const config = this.engine.config.mcps?.[pname];
    if (!config) {
      this.logger.error('[McpsCommand.execInfo]', `mcp "${pname}" not found in config`);
      return;
    }

    const client = new Mcp(this.engine, this.logger, pname, config);
    try {
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

    const pname = this.args[1] || await input({
      message: 'Enter mcp name (e.g. gloobeam):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid name (use a-z, 0-9, _ and -):',
    });
    if (!pname) {
      this.logger.warn('[McpsCommand.execDrop]', 'usage: marvin mcps drop <name>');
      return;
    }

    // should exist
    if (!this.engine.config.mcps?.[pname]) {
      this.logger.warn('[McpsCommand.execDrop]', `mcp "${pname}" not found in config`);
      return;
    }

    // disconnect and remove the mcp from the engine if loaded
    await this.engine.dropMcp(pname);

    // remove the mcp from the config
    delete this.engine.config.mcps![pname];

    // unlink from tasks
    for (const task of Object.values(this.engine.config.tasks || {})) {
      if (task.mcps?.includes(pname)) {
        task.mcps = task.mcps.filter(id => id !== pname);
      }
    }

    // save config
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      this.logger.info('[dry]', `would persist: config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
      this.logger.info(`config updated: ${cpath}`);
    }

    this.logger.info('mcp dropped');
  }
}
