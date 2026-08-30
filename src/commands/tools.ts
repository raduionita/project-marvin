import { input } from '../terminal.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { tryJsonParse } from "../helpers";
import { listSystems, loadSystem } from "../systems";
import { listTools as listToolFiles, listCustomTools, loadTool } from "../tools";
import { readSkill, loadSkill } from "../skills";
import { Command, System, ToolMeta } from "../types";

export default class ToolsCommand extends Command {
  async exec() {
    this.logger.debug('[ToolsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      case 'help':
        this.execHelp();
      break;
      case 'list':
        await this.listTools();
      break;
      case 'add':
        await this.engine.load();
        await this.execAdd();
        await this.engine.drop();
      break;
      case 'edit':
        this.engine.load();
        await this.execEdit();
        await this.engine.drop();
      break;
      default:
        await this.execTool(cmd);
      break;
    }
  }

  execHelp() {
    this.logger.info('usage: marvin tools [subcommand] [params]');
    this.logger.info('commands:');
    this.logger.info('  help         ', 'show this help');
    this.logger.info('  list         ', 'list available tools, for each one, it\'s connected agents');
    this.logger.info('  add <name> [desc]', 'create a new custom tool in ~/.marvin/tools');
    this.logger.info('  edit <name> [desc]', 'edit an existing custom tool in ~/.marvin/tools');
    this.logger.info('  [name]       ', 'call a tool, pass params as a JSON object');
  }

  async listTools() {
    this.logger.debug('[ToolCommand.listTools]', 'tools:');
    const custom = new Set(listCustomTools(this.engine));
    const files = listToolFiles(this.engine);
    for (const file of files) {
      try {
        const instance = await loadTool(this.engine, file);
        const meta = instance.meta as ToolMeta;
        // register instance of Tool
        this.engine.tools[meta.function.name] = instance;
        const kind = custom.has(file) ? 'custom tool' : 'tool';
        this.logger.info('[ToolCommand.listTools]', `  ${kind} [${meta.function.name}]`, JSON.stringify(meta.function.parameters.properties));
      } catch (err) {
        this.logger.error('[ToolCommand.listTools]', `failed to load ${file}:`, err);
      }
    }
  }

  async execTool(name: string) {
    this.logger.debug('[ToolCommand.execTool]', name);
    try {
      const system = await loadSystem(this.engine, 'browser');
      this.engine.systems['browser'] = system;
      // call tool
      const params = tryJsonParse(this.args.slice(1).join(' ')) as { [key: string]: any };
      // load tool (repo tools first, then custom workspace tools)
      const tool = await loadTool(this.engine, name);
      // call the tool
      const output = await tool.call(params);
      // output
      this.logger.info('[ToolCommand.execTool]', JSON.stringify(output, null, 2));
    } catch (err) {
      this.logger.error('[ToolCommand.execTool]', `failed to load ${name}:`, err);
    }
  }

  // `marvin tools add [name] [description]` // create a new custom tool
  async execAdd() {
    this.logger.debug('[ToolCommand.execAdd]', 'creating a custom tool...');

    // ask for the tool name
    const name = this.args[1] || await input({
      message: 'Tool name (e.g. web_search):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid tool name (use a-z, 0-9, _ and -)',
    });
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.logger.error('[ToolCommand.execAdd]', 'invalid tool name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // ask for what the tool should do
    const description = this.args.slice(2).join(' ') || await input({ message: 'What should the tool do?', required: true });
    if (!description) {
      this.logger.error('[ToolCommand.execAdd]', 'no description provided, exiting');
      return;
    }

    // check if the tool already exists
    const tpath = join(this.engine.work, 'tools', `${name}.ts`);
    if (existsSync(tpath)) {
      this.logger.warn(`tool "${name}" already exists at ${tpath}`);
      return;
    }

    // load the tools-create skill that teaches how to create tools
    let instructions: string;
    try {
      instructions = readSkill(loadSkill(this.engine, 'tools-create'));
    } catch {
      this.logger.error('[ToolCommand.execAdd]', 'the "tools-create" skill was not found, cannot create tools');
      return;
    }

    // load the engine (models + agents) so we can prompt the LLM
    await this.engine.load();

    const prompt = [
      instructions,
      '',
      '## Task',
      `Create a new tool named "${name}".`,
      description,
      '',
      'Return ONLY the tool file content.',
    ].join('\n');

    const marvin = this.engine.agents[this.engine.config.settings.name];
    if (!marvin) {
      this.logger.error('[ToolCommand.execAdd]', `agent "${this.engine.config.settings.name}" not found`);
      return;
    }

    const result = await marvin.sendChat(undefined, prompt);
    if (result.error || !result.content) {
      this.logger.error('[ToolCommand.execAdd]', 'no result from the LLM');
      return;
    }

    // resolve the MARVIN_ROOT placeholder the skill keeps literal in the tool import
    let content = result.content.trim().replaceAll('{MARVIN_ROOT}', this.engine.root);

    // persist the tool to ~/.marvin/tools/<name>.ts
    mkdirSync(join(this.engine.work, 'tools'), { recursive: true });
    writeFileSync(tpath, content + '\n');
    // register the tool in the engine (no reload needed)
    await this.reloadTools();

    this.logger.info(`tool "${name}" created, saved to ${tpath}`);
  }

  // `marvin tools edit [name] [description]` // edit an existing custom tool
  async execEdit() {
    this.logger.debug('[ToolCommand.execEdit]', 'editing a custom tool...');

    // ask for the tool name
    const name = this.args[1] || await input({
      message: 'Tool name (e.g. web_search):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid tool name (use a-z, 0-9, _ and -)',
    });
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.logger.error('[ToolCommand.execEdit]', 'invalid tool name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // the tool must exist in the workspace
    const tpath = join(this.engine.work, 'tools', `${name}.ts`);
    if (!existsSync(tpath)) {
      this.logger.error('[ToolCommand.execEdit]', `tool "${name}" not found in ~/.marvin/tools`);
      return;
    }
    const current = readFileSync(tpath, 'utf8');

    // ask for what to change
    const description = this.args.slice(2).join(' ') || await input({ message: 'What should change about the tool?', required: true });
    if (!description) {
      this.logger.error('[ToolCommand.execEdit]', 'no description provided, exiting');
      return;
    }

    // load the tools-edit skill that teaches how to edit tools
    let instructions: string;
    try {
      instructions = readSkill(loadSkill(this.engine, 'tools-edit'));
    } catch {
      this.logger.error('[ToolCommand.execEdit]', 'the "tools-edit" skill was not found, cannot edit tools');
      return;
    }

    // load the engine (models + agents) so we can prompt the LLM
    await this.engine.load();

    const prompt = [
      instructions,
      '',
      '## Current tool code',
      '```typescript',
      current,
      '```',
      '',
      '## Task',
      `Edit the tool "${name}" to: ${description}`,
      '',
      'Return ONLY the complete updated tool file content.',
    ].join('\n');

    const result = await this.engine.agents[this.engine.config.settings.name]!.sendChat(undefined, prompt);
    if (result.error || !result.content) {
      this.logger.error('[ToolCommand.execEdit]', 'no result from the LLM');
      return;
    }
    
    // resolve the MARVIN_ROOT placeholder the skill keeps literal in the tool import
    let content = result.content.trim().replaceAll('{MARVIN_ROOT}', this.engine.root);

    // persist the edited tool back to ~/.marvin/tools/<name>.ts
    writeFileSync(tpath, content + '\n');
    // re-register the tool in the engine (no reload needed)
    await this.reloadTools();

    this.logger.info(`tool "${name}" updated, saved to ${tpath}`);
  }

  // reload tool registrations so newly created/edited custom tools take effect
  async reloadTools() {
    this.logger.debug('[ToolCommand.reloadTools]');
    this.engine.tools = {};
    await this.engine.loadTools();
  }


  async loadSystems() {
    this.logger.debug('[ToolCommand.loadSystems]');

    const files = listSystems(this.engine);
    for (const name of files) {
      try {
        const Module = await import(`../systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          this.logger.error('[ToolCommand.loadSystems]', `${name} does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this.engine);
        await instance.load();
        this.engine.systems[name] = instance;
        this.logger.debug('[ToolCommand.loadSystems]', `system [${name}] loaded`);
      } catch (err) {
        this.logger.error('[ToolCommand.loadSystems]', `failed to load ${name}:`, err);
        process.exit(1);
      }
    }
  }

  async dropSystems() {
    this.logger.debug('[ToolCommand.dropSystems]');
    for (const system of Object.values(this.engine.systems)) {
      try {
        await system.drop();
      } catch (err) {
        this.logger.error('[ToolCommand.dropSystems]', `error detaching system:`, err);
      }
    }
    this.engine.systems = {};
  }

  async drop() {
    this.logger.debug('[ToolCommand.drop]');
    await this.dropSystems();
  }
}
