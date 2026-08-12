import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { promises } from 'readline';

import { tryJsonParse } from "../helpers";
import { listSystems } from "../systems";
import { listTools, listCustomTools } from "../tools";
import { readSkill } from "../skills";
import { Command, System, Tool, ToolMeta } from "../types";

export default class ToolsCommand extends Command {
  // overridable for tests (scripted answers)
  public ask?: (question: string) => Promise<string>;

  async exec() {
    console.debug('[ToolsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      case 'help':
        this.execHelp();
      break;
      case 'list':
        await this.listTools();
      break;
      case 'add':
        await this.execAdd();
      break;
      case 'edit':
        await this.execEdit();
      break;
      default:
        // call a tool by name
        await this.loadSystems();
        const params = tryJsonParse(this.args.slice(1).join(' ')) as { [key: string]: any };
        await this.callTool(cmd, params);
      break;
    }
  }

  execHelp() {
    console.info('usage: marvin tools [subcommand] [params] [--dry]');
    console.info('commands:');
    console.info('  help         ', 'show this help');
    console.info('  list         ', 'list available tools, for each one, it\'s connected agents');
    console.info('  add <name> [desc]', 'create a new custom tool in ~/.marvin/tools');
    console.info('  edit <name> [desc]', 'edit an existing custom tool in ~/.marvin/tools');
    console.info('  [name]       ', 'call a tool, pass params as a JSON object');
  }

  async listTools() {
    console.debug('[ToolCommand.listTools]', 'tools:');
    const files = listTools(this.engine).map(f => f.replace('.ts', ''));
    for (const file of files) {
      const name = file;
      try {
        const Module = await import(`../tools/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.error('[ToolCommand.listTools]', `${file} does not export a Tool class, skipping`);
          continue;
        }
        // register instance of Tool
        const instance = new Class(this.engine);
        const meta = instance.meta as ToolMeta;
        this.engine.tools[meta.function.name] = instance;
        console.info('[ToolCommand.listTools]', `  tool [${meta.function.name}]`, JSON.stringify(meta.function.parameters.properties));
      } catch (err) {
        console.error('[ToolCommand.listTools]', `failed to load ${file}:`, err);
      }
    }

    // custom tools from the workspace (~/.marvin/tools)
    const cfiles = listCustomTools(this.engine).map(f => f.replace('.ts', ''));
    for (const name of cfiles) {
      try {
        const Module = await import(join(this.engine.work, 'tools', `${name}.ts`));
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof Tool)) {
          console.error('[ToolCommand.listTools]', `${name} does not export a Tool class, skipping`);
          continue;
        }
        const instance = new Class(this.engine);
        const meta = instance.meta as ToolMeta;
        this.engine.tools[meta.function.name] = instance;
        console.info('[ToolCommand.listTools]', `  custom tool [${meta.function.name}]`, JSON.stringify(meta.function.parameters.properties));
      } catch (err) {
        console.error('[ToolCommand.listTools]', `failed to load custom tool ${name}:`, err);
      }
    }
  }

  async callTool(name: string, params: { [key: string]: any } = {}) {
    console.debug('[ToolCommand.callTool]', name, JSON.stringify(params));
    try {
      // load tool (repo tools first, then custom workspace tools)
      let Module: any;
      try {
        Module = await import(`../tools/${name}.js`);
      } catch {
        Module = await import(join(this.engine.work, 'tools', `${name}.ts`));
      }
      const Class = Module.default;
      if (!Class || !(Class.prototype instanceof Tool)) {
        console.error('[ToolCommand.callTool]', `${name} does not export a Tool class, skipping`);
        throw new Error(`[ToolCommand.callTool] ERROR - ${name} does not export a Tool class`);
      }
      // register instance of Tool
      const instance = new Class(this.engine);
      // dry guard
      if (this.engine.isDry) {
        console.info('[ToolCommand.callTool]', '[dry] tool:', name, JSON.stringify(params));
        return;
      }
      // call the tool          
      const output = await instance.call(params);
      // output
      console.info('[ToolCommand.callTool]', JSON.stringify(output, null, 2));
    } catch (err) {
      console.error('[ToolCommand.callTool]', `failed to load ${name}:`, err);
    }
  }

  // `marvin tools add [name] [description]` // create a new custom tool
  async execAdd() {
    console.debug('[ToolCommand.execAdd]', 'creating a custom tool...');

    const ask = this.ask || (async (q: string) => {
      const pli = promises.createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await pli.question(q)).trim();
      pli.close();
      return answer;
    });

    // ask for the tool name
    const name = this.args[1] || await ask('Tool name (e.g. web_search): ');
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      console.error('[ToolCommand.execAdd]', 'invalid tool name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // ask for what the tool should do
    const description = this.args.slice(2).join(' ') || await ask('What should the tool do? ');
    if (!description) {
      console.error('[ToolCommand.execAdd]', 'no description provided, exiting');
      return;
    }

    // check if the tool already exists
    const tpath = join(this.engine.work, 'tools', `${name}.ts`);
    if (existsSync(tpath)) {
      console.warn(`tool "${name}" already exists at ${tpath}`);
      return;
    }

    // load the TOOLS-CREATE skill that teaches how to create tools
    const skill = this.engine.skills['tools-create'];
    if (!skill) {
      console.error('[ToolCommand.execAdd]', 'the "tools-create" skill is not loaded, cannot create tools');
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

    let content = '';
    if (this.engine.isDry) {
      console.info('[dry]', 'prompt:', prompt.slice(0, 200));
    } else {
      const result = await this.engine.execChat(undefined, this.engine.config.settings.name, prompt, 'text');
      if (!result || !result.content) {
        console.error('[ToolCommand.execAdd]', 'no result from the LLM');
        return;
      }
      content = result.content.trim();
    }
    // resolve the MARVIN_ROOT placeholder the skill keeps literal in the tool import
    content = content.replaceAll('{MARVIN_ROOT}', this.engine.root);

    // persist the tool to ~/.marvin/tools/<name>.ts
    if (this.engine.isDry) {
      console.info('[dry]', `would write tool to ${tpath}`);
    } else {
      mkdirSync(join(this.engine.work, 'tools'), { recursive: true });
      writeFileSync(tpath, content + '\n');
      // register the tool in the engine (no reload needed)
      await this.reloadTools();
    }

    console.info(`tool "${name}" created, saved to ${tpath}`);
  }

  // `marvin tools edit [name] [description]` // edit an existing custom tool
  async execEdit() {
    console.debug('[ToolCommand.execEdit]', 'editing a custom tool...');

    const ask = this.ask || (async (q: string) => {
      const pli = promises.createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await pli.question(q)).trim();
      pli.close();
      return answer;
    });

    // ask for the tool name
    const name = this.args[1] || await ask('Tool name (e.g. web_search): ');
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      console.error('[ToolCommand.execEdit]', 'invalid tool name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // the tool must exist in the workspace
    const tpath = join(this.engine.work, 'tools', `${name}.ts`);
    if (!existsSync(tpath)) {
      console.error('[ToolCommand.execEdit]', `tool "${name}" not found in ~/.marvin/tools`);
      return;
    }
    const current = readFileSync(tpath, 'utf8');

    // ask for what to change
    const description = this.args.slice(2).join(' ') || await ask('What should change about the tool? ');
    if (!description) {
      console.error('[ToolCommand.execEdit]', 'no description provided, exiting');
      return;
    }

    // load the TOOLS-EDIT skill that teaches how to edit tools
    const skill = this.engine.skills['tools-edit'];
    if (!skill) {
      console.error('[ToolCommand.execEdit]', 'the "tools-edit" skill is not loaded, cannot edit tools');
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
      console.info('[dry]', 'prompt:', prompt.slice(0, 200));
    } else {
      const result = await this.engine.execChat(undefined, this.engine.config.settings.name, prompt, 'text');
      if (!result || !result.content) {
        console.error('[ToolCommand.execEdit]', 'no result from the LLM');
        return;
      }
      content = result.content.trim();
    }
    // resolve the MARVIN_ROOT placeholder the skill keeps literal in the tool import
    content = content.replaceAll('{MARVIN_ROOT}', this.engine.root);

    // persist the edited tool back to ~/.marvin/tools/<name>.ts
    if (this.engine.isDry) {
      console.info('[dry]', `would write tool to ${tpath}`);
    } else {
      writeFileSync(tpath, content + '\n');
      // re-register the tool in the engine (no reload needed)
      await this.reloadTools();
    }

    console.info(`tool "${name}" updated, saved to ${tpath}`);
  }

  // reload tool registrations so newly created/edited custom tools take effect
  async reloadTools() {
    console.debug('[ToolCommand.reloadTools]');
    this.engine.tools = {};
    await this.engine.loadTools();
  }


  async loadSystems() {
    console.debug('[ToolCommand.loadSystems]');

    const files = listSystems(this.engine).map(f => f.replace('.ts', ''));
    for (const name of files) {
      try {
        const Module = await import(`../systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          console.error('[ToolCommand.loadSystems]', `${name} does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this.engine);
        await instance.load();
        this.engine.systems[name] = instance;
        console.debug('[ToolCommand.loadSystems]', `system [${name}] loaded`);
      } catch (err) {
        console.error('[ToolCommand.loadSystems]', `failed to load ${name}:`, err);
        process.exit(1);
      }
    }
  }

  async dropSystems() {
    console.debug('[ToolCommand.dropSystems]');
    for (const system of Object.values(this.engine.systems)) {
      try {
        await system.drop();
      } catch (err) {
        console.error('[ToolCommand.dropSystems]', `error detaching system:`, err);
      }
    }
    this.engine.systems = {};
  }

  async drop() {
    console.debug('[ToolCommand.drop]');
    await this.dropSystems();
  }
}