import { checkbox, confirm, input } from '@inquirer/prompts';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';

import { Command } from "../types";
import { Mcp, McpConfig } from '../mcp.js';
import { tryJsonParse } from '../helpers.js';
import { multiline } from '../termina.js';

// read all of stdin (for `echo '{...}' | marvin mcps add name`)
function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

// unwrap common paste formats down to the server spec:
// - claude-style wrapper: { "mcpServers": { "<name>": {...} } }
// - bare named server:    { "<name>": { "command": ... } }
// - direct spec:          { "command": ..., "args": [...], "env": {...} }
export function unwrapMcpSnippet(json: {[key:string]:any}): { name?: string, spec: any } {
  if (json && typeof json === 'object' && !Array.isArray(json) && json.mcpServers && typeof json.mcpServers === 'object') {
    const entries = Object.entries(json.mcpServers);
    if (entries.length) return { name: entries[0]![0], spec: entries[0]![1] };
  }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const keys = Object.keys(json);
    const value = keys.length === 1 ? (json as { [key: string]: any })[keys[0]!] : undefined;
    if (keys.length === 1 && value && typeof value === 'object' && !Array.isArray(value) && (value as any).command) {
      return { name: keys[0], spec: value };
    }
  }
  return { spec: json };
}

// validate an mcp server spec: command required, args string[], env string map
export function validateMcpSpec(spec: {[key:string]:any}): { ok: boolean, error?: string, config?: McpConfig } {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, error: 'snippet must be a json object' };
  }
  if (typeof spec.command !== 'string' || !spec.command.trim()) {
    return { ok: false, error: 'missing required "command" (e.g. "npx")' };
  }
  if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some((a: any) => typeof a !== 'string'))) {
    return { ok: false, error: '"args" must be an array of strings' };
  }
  if (spec.env !== undefined && (!spec.env || typeof spec.env !== 'object' || Array.isArray(spec.env) || Object.values(spec.env).some((v: any) => typeof v !== 'string'))) {
    return { ok: false, error: '"env" must be an object of string values' };
  }
  const config: McpConfig = {
    enabled: spec.enabled === undefined ? true : !!spec.enabled,
    command: spec.command.trim(),
    args: spec.args || [],
    ...(spec.env ? { env: spec.env } : {}),
  };
  return { ok: true, config };
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

    const { spec } = unwrapMcpSnippet(json);

    const parsed = validateMcpSpec(spec);
    if (!parsed.ok || !parsed.config) {
      this.logger.error('[McpsCommand.execAdd]', parsed.error!);
      return;
    }
    const config = parsed.config;

    this.warnRisks(config);

    // verify connectivity before saving (spawn + initialize + listTools)
    const ok = await this.verify(name, config);
    if (!ok) {
      const saveAnyway = await confirm({ message: 'Connection failed. Save anyway?', default: false });
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
    this.engine.config.mcps = this.engine.config.mcps || {};
    this.engine.config.mcps[name] = config;

    this.persist(`mcp "${name}" configured`);
  }

  // `marvin mcps edit <name> [file]`
  async execEdit() {
    this.logger.debug('[McpsCommand.execEdit]');

    const pname = this.args[1] || await input({
      message: 'Enter mcp name (e.g. gloobeam):',
      required: true,
    });

    // must exist
    const current = this.engine.config.mcps?.[pname];
    if (!current) {
      this.logger.error('[McpsCommand.execEdit]', `mcp "${pname}" not found in config`);
      return;
    }

    const text = await this.readSnippet(this.args[2]);
    if (text === null) return;

    const raw = tryJsonParse<any>(text);
    if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) {
      this.logger.error('[McpsCommand.execEdit]', 'invalid json snippet');
      return;
    }

    const { spec } = unwrapMcpSnippet(raw);
    const parsed = validateMcpSpec(spec);
    if (!parsed.ok || !parsed.config) {
      this.logger.error('[McpsCommand.execEdit]', parsed.error!);
      return;
    }

    // replace the spawn spec, keeping the previous enabled flag unless set
    const config = parsed.config;
    if (spec.enabled === undefined) config.enabled = current.enabled;

    this.warnRisks(config);

    const ok = await this.verify(pname, config);
    if (!ok) {
      const saveAnyway = await confirm({ message: 'Connection failed. Save anyway?', default: false });
      if (!saveAnyway) {
        this.logger.info('[McpsCommand.execEdit]', 'aborted, nothing saved');
        return;
      }
    }

    this.engine.config.mcps![pname] = config;

    this.persist(`mcp "${pname}" updated`);
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
      if (!client.tools.length) {
        this.logger.log('  (no tools)');
      }
      for (const tool of client.tools) {
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

    const pname = this.args[1];
    if (!pname) {
      this.logger.warn('[McpsCommand.execDrop]', 'usage: marvin mcps drop <name>');
      return;
    }

    if (!this.engine.config.mcps?.[pname]) {
      this.logger.error('[McpsCommand.execDrop]', `mcp "${pname}" not found in config`);
      return;
    }

    // disconnect and remove the mcp from the engine if loaded
    await this.engine.dropMcp(pname);

    delete this.engine.config.mcps![pname];

    // unlink from tasks
    for (const task of Object.values(this.engine.config.tasks || {})) {
      if (task.mcps?.includes(pname)) {
        task.mcps = task.mcps.filter(id => id !== pname);
      }
    }

    this.persist(`mcp "${pname}" dropped`);
  }

  // read a multi-line json snippet from stdin: collects pasted lines until a
  // blank line (interactive) or EOF (piped)
  protected async pasteSnippet(): Promise<string> {
    const rl = createInterface({ input: process.stdin });
    const lines: string[] = [];
    return await new Promise<string>(resolve => {
      process.stdout.write('Paste the mcp json snippet (end with an empty line):\n');
      rl.on('line', line => {
        if (!line.trim()) {
          rl.close();
          return;
        }
        lines.push(line);
      });
      rl.on('close', () => resolve(lines.join('\n')));
    });
  }

  // read the snippet from a file arg, piped stdin, or an interactive prompt
  private async readSnippet(arg: string | undefined): Promise<string | null> {    if (arg) {
      if (!existsSync(arg)) {
        this.logger.error('[McpsCommand.readSnippet]', `file not found: ${arg}`);
        return null;
      }
      return readFileSync(arg, 'utf8');
    }
    if (process.stdin && !process.stdin.isTTY) {
      return await readStdin();
    }
    return await input({ message: 'Paste the mcp json snippet (single line):', required: true });
  }

  // spawn + initialize + listTools, printing what the server exposes
  private async verify(name: string, config: McpConfig): Promise<boolean> {
    this.logger.info(`verifying mcp "${name}" (spawning ${config.command})...`);

    const client = new Mcp(this.engine, this.logger, name, config);
    try {
      await client.load();
      this.logger.info(`mcp "${name}" connected, ${client.tools.length} tool(s) available`);
      return true;
    } catch (err) {
      this.logger.error('[McpsCommand.verify]', `connection failed:`, (err as Error).message);
      return false;
    } finally {
      await client.drop();
    }
  }

  // static risk notes shown before saving
  private warnRisks(config: McpConfig) {
    if (/^npx(\.cmd)?$/i.test(config.command) && config.args.some(a => a === '-y')) {
      this.logger.warn('[McpsCommand.warnRisks]', '"npx -y" downloads and runs a package from npm on every start (supply-chain risk)');
    }
    if (config.env && Object.keys(config.env).length) {
      this.logger.warn('[McpsCommand.warnRisks]', 'env values (credentials) are stored as plain text in marvin.json');
    }
  }

  // persist the engine config to marvin.json
  private persist(message: string) {
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      this.logger.info('[McpsCommand.persist]', '[dry]', `would persist: ${message}, config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }
    this.logger.info('[McpsCommand.persist]', `${message}, config persisted to ${cpath}`);
  }
}
