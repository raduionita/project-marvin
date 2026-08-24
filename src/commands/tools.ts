import { input } from '@inquirer/prompts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { tryJsonParse } from "../helpers";
import { listSystems } from "../systems";
import { listInternalTools, listCustomTools } from "../tools";
import { readSkill } from "../skills";
import { Command, System, Tool, ToolMeta } from "../types";

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
        // call a tool by name
        await this.loadSystems();
        const params = tryJsonParse(this.args.slice(1).join(' ')) as { [key: string]: any };
        await this.execTool(cmd, params);
      break;
    }
  }

  execHelp() {
    this.logger.info('usage: marvin tools [subcommand] [params] [--dry]');
    this.logger.info('commands:');
    this.logger.info('  help         ', 'show this help');
    this.logger.info('  list         ', 'list available tools, for each one, it\'s connected agents');
    this.logger.info('  add <name> [desc]', 'create a new custom tool in ~/.marvin/tools');
    this.logger.info('  edit <name> [desc]', 'edit an existing custom tool in ~/.marvin/tools');
    this.logger.info('  [name]       ', 'call a tool, pass params as a JSON object');
  }

  async listTools() {
    this.logger.debug('[ToolCommand.listTools]', 'tools:');
    const files = listInternalTools(this.engine);
    for (const file of files) {
      const name = file;
      try {
        const Module = await import(`../tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          this.logger.error('[ToolCommand.listTools]', `${file} does not export a Tool class, skipping`);
          continue;
        }
        // register instance of Tool
        const instance = new Class(this.engine, this.logger);
        const meta = instance.meta as ToolMeta;
        this.engine.tools[meta.function.name] = instance;
        this.logger.info('[ToolCommand.listTools]', `  tool [${meta.function.name}]`, JSON.stringify(meta.function.parameters.properties));
      } catch (err) {
        this.logger.error('[ToolCommand.listTools]', `failed to load ${file}:`, err);
      }
    }

    // custom tools from the workspace (~/.marvin/tools)
    const cfiles = listCustomTools(this.engine);
    for (const name of cfiles) {
      try {
        const Module = await import(join(this.engine.work, 'tools', `${name}.ts`));
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          this.logger.error('[ToolCommand.listTools]', `${name} does not export a Tool class, skipping`);
          continue;
        }
        const instance = new Class(this.engine, this.logger);
        const meta = instance.meta as ToolMeta;
        this.engine.tools[meta.function.name] = instance;
        this.logger.info('[ToolCommand.listTools]', `  custom tool [${meta.function.name}]`, JSON.stringify(meta.function.parameters.properties));
      } catch (err) {
        this.logger.error('[ToolCommand.listTools]', `failed to load custom tool ${name}:`, err);
      }
    }
  }

  async execTool(name: string, params: { [key: string]: any } = {}) {
    this.logger.debug('[ToolCommand.execTool]', name, JSON.stringify(params));
    try {
      const params = tryJsonParse(this.args.slice(1).join(' ')) as { [key: string]: any };
      // load tool (repo tools first, then custom workspace tools)
      let Module: any;
      try {
        Module = await import(`../tools/${name}.js`);
      } catch {
        Module = await import(join(this.engine.work, 'tools', `${name}.ts`));
      }
      const Class = Module.default;
      if (!Class || !(Class.prototype instanceof Tool)) {
        this.logger.error('[ToolCommand.execTool]', `${name} does not export a Tool class, skipping`);
        throw new Error(`[ToolCommand.execTool] ERROR - ${name} does not export a Tool class`);
      }
      // register instance of Tool
      const instance = new Class(this.engine, this.logger);
      // dry guard
      if (this.engine.isDry) {
        this.logger.info('[ToolCommand.execTool]', '[dry] tool:', name, JSON.stringify(params));
        return;
      }
      // call the tool          
      const output = await instance.call(params);
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

    // load the TOOLS-CREATE skill that teaches how to create tools
    const skill = this.engine.skills['tools-create'];
    if (!skill) {
      this.logger.error('[ToolCommand.execAdd]', 'the "tools-create" skill is not loaded, cannot create tools');
      return;
    }
    const instructions = readSkill(skill);

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

    let content = '';
    if (this.engine.isDry) {
      this.logger.info('[dry]', 'prompt:', prompt.slice(0, 200));
    } else {
      const result = await marvin.sendChat(undefined, prompt);
      if (result.error || !result.content) {
        this.logger.error('[ToolCommand.execAdd]', 'no result from the LLM');
        return;
      }
      content = result.content.trim();
    }
    // resolve the MARVIN_ROOT placeholder the skill keeps literal in the tool import
    content = content.replaceAll('{MARVIN_ROOT}', this.engine.root);

    // persist the tool to ~/.marvin/tools/<name>.ts
    if (this.engine.isDry) {
      this.logger.info('[dry]', `would write tool to ${tpath}`);
    } else {
      mkdirSync(join(this.engine.work, 'tools'), { recursive: true });
      writeFileSync(tpath, content + '\n');
      // register the tool in the engine (no reload needed)
      await this.reloadTools();
    }

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

    // load the TOOLS-EDIT skill that teaches how to edit tools
    const skill = this.engine.skills['tools-edit'];
    if (!skill) {
      this.logger.error('[ToolCommand.execEdit]', 'the "tools-edit" skill is not loaded, cannot edit tools');
      return;
    }
    const instructions = readSkill(skill);

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

    let content = '';
    if (this.engine.isDry) {
      this.logger.info('[dry]', 'prompt:', prompt.slice(0, 200));
    } else {
      const result = await this.engine.agents[this.engine.config.settings.name]!.sendChat(undefined, prompt);
      if (result.error || !result.content) {
        this.logger.error('[ToolCommand.execEdit]', 'no result from the LLM');
        return;
      }
      content = result.content.trim();
    }
    // resolve the MARVIN_ROOT placeholder the skill keeps literal in the tool import
    content = content.replaceAll('{MARVIN_ROOT}', this.engine.root);

    // persist the edited tool back to ~/.marvin/tools/<name>.ts
    if (this.engine.isDry) {
      this.logger.info('[dry]', `would write tool to ${tpath}`);
    } else {
      writeFileSync(tpath, content + '\n');
      // re-register the tool in the engine (no reload needed)
      await this.reloadTools();
    }

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

    const files = listSystems(this.engine).map(f => f.replace('.ts', ''));
    for (const name of files) {
      try {
        const Module = await import(`../systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          this.logger.error('[ToolCommand.loadSystems]', `${name} does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this.engine, this.logger);
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
