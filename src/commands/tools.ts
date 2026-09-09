import { input, select } from '../terminal.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { tryJsonParse } from "../helpers";
import { listCustomTools, listInternalTools, listTools, loadTool } from "../tools";
import { readSkill, loadSkill } from "../skills";
import { Chat, Command, ToolMeta } from "../types";
import logger from '../logger.js';

export default class ToolsCommand extends Command {
  async exec() {
    logger.debug('[ToolsCommand.exec]');

    const cmd = this.args[0] || '';
    switch (cmd) {
      case 'help':
        this.execHelp();
      break;
      case 'list':
        await this.execList();
      break;
      case 'add':
        // await this.engine.load();
        await this.execAdd();
        // await this.engine.drop();
      break;
      case 'edit':
        // this.engine.load();
        await this.execEdit();
        // await this.engine.drop();
      break;
      default:
        await this.execTool();
      break;
    }
  }

  execHelp() {
    logger.info('usage: marvin tools [subcommand] [params]');
    logger.info('commands:');
    logger.info('  help         ', 'show this help');
    logger.info('  list         ', 'list available tools, for each one, it\'s connected agents');
    logger.info('  add <name> [desc]', 'create a new custom tool in ~/.marvin/tools');
    logger.info('  edit <name> [desc]', 'edit an existing custom tool in ~/.marvin/tools');
    logger.info('  [name]       ', 'call a tool, pass params as a JSON object');
  }

  async execList() {
    logger.info('tools:');
    const tools = listTools(this.engine);
    for (const file of tools) {
      try {
        const instance = await loadTool(this.engine, file);
        const meta = instance.meta as ToolMeta;
        // register instance of Tool
        this.engine.tools[meta.function.name] = instance;
        logger.info(`- ${meta.function.name}`, JSON.stringify(meta.function.parameters.properties));
      } catch (err) {
        logger.error('[ToolCommand.execList]', `failed to load ${file}:`, err);
      }
    }
  }

  async execTool() {
    let name = this.args[0] || '';
    try {
      // tools may depend on any system (browser, watch, ...), so load them all
      await this.engine.loadSystems();

      // resolve the tool name: CLI arg or interactive selection
      if (!name) {
        const tools = listTools(this.engine);
        if (!tools.length) {
          logger.error('[ToolCommand.execTool]', 'no tools available');
          return;
        }
        name = await select({
          message: 'Select a tool:',
          choices: tools.map(t => ({ name: t, value: t })),
        });
      }
      if (!name) {
        logger.error('[ToolCommand.execTool]', 'no tool selected, exiting');
        return;
      }

      // load tool (repo tools first, then custom workspace tools)
      const tool = await loadTool(this.engine, name);
      const meta = tool.meta as ToolMeta;
      const props: ToolMeta['function']['parameters']['properties'] = meta.function.parameters.properties || {};
      const required = new Set(meta.function.parameters.required || []);

      // CLI params as JSON, prompted per-property for anything missing
      const params: { [key: string]: any } = {};
      for (const [key, prop] of Object.entries(props)) {
        if (params[key] !== undefined && params[key] !== '') continue;
        const label = prop.description ? `${key} (${prop.description})` : key;
        if (prop.enum?.length) {
          params[key] = await select({
            message: `${label}:`,
            choices: prop.enum.map(v => ({ name: v, value: v })),
          });
        } else if (prop.type === 'boolean') {
          params[key] = await select({
            message: `${label}:`,
            choices: [{ name: 'true', value: true }, { name: 'false', value: false }],
          });
        } else {
          const answer = await input({ message: `${label}:`, required: required.has(key) });
          if (answer === '' && !required.has(key)) continue;
          params[key] = prop.type === 'number' || prop.type === 'integer' ? Number(answer)
            : prop.type === 'array' || prop.type === 'object' ? tryJsonParse(answer) ?? answer
            : answer;
        }
      }

      // call the tool with agent/chat context (required by Tool.call)
      const agent = this.engine.agents[this.engine.config.settings.name] ?? Object.values(this.engine.agents)[0] ?? ({} as never);
      const chat = {} as Chat;

      // call the tool with agent/chat context (required by Tool.call)
      const output = await tool.call(params, agent, chat);
      // output
      logger.info(JSON.stringify(output, null, 2));
    } catch (err) {
      logger.error('[ToolCommand.execTool]', `failed to load ${name}:`, err);
    } finally {
      this.engine.dropSystems();
    }
  }

  // `marvin tools add [name] [description]` // create a new custom tool
  async execAdd() {
    logger.debug('[ToolCommand.execAdd]', 'creating a custom tool...');

    // ask for the tool name
    const name = this.args[1] || await input({
      message: 'Tool name (e.g. web_search):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid tool name (use a-z, 0-9, _ and -)',
    });
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      logger.error('[ToolCommand.execAdd]', 'invalid tool name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // ask for what the tool should do
    const description = this.args.slice(2).join(' ') || await input({ message: 'What should the tool do?', required: true });
    if (!description) {
      logger.error('[ToolCommand.execAdd]', 'no description provided, exiting');
      return;
    }

    // check if the tool already exists
    const tpath = join(this.engine.work, 'tools', `${name}.ts`);
    if (existsSync(tpath)) {
      logger.warn(`tool "${name}" already exists at ${tpath}`);
      return;
    }

    // load the tools-create skill that teaches how to create tools
    let instructions: string;
    try {
      instructions = readSkill(loadSkill(this.engine, 'tools-create'));
    } catch {
      logger.error('[ToolCommand.execAdd]', 'the "tools-create" skill was not found, cannot create tools');
      return;
    }

    // load the engine (models + agents) so we can prompt the LLM
    // await this.engine.load();

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
      logger.error('[ToolCommand.execAdd]', `agent "${this.engine.config.settings.name}" not found`);
      return;
    }

    const result = await marvin.sendChat(undefined, prompt);
    if (result.error || !result.content) {
      logger.error('[ToolCommand.execAdd]', 'no result from the LLM');
      return;
    }

    // resolve the MARVIN_ROOT placeholder the skill keeps literal in the tool import
    let content = result.content.trim().replaceAll('{MARVIN_ROOT}', this.engine.root);

    // persist the tool to ~/.marvin/tools/<name>.ts
    mkdirSync(join(this.engine.work, 'tools'), { recursive: true });
    writeFileSync(tpath, content + '\n');

    // reload
    this.engine.tools = {};
    await this.engine.loadTools();

    logger.info(`tool "${name}" created, saved to ${tpath}`);
  }

  // `marvin tools edit [name] [description]` // edit an existing custom tool
  async execEdit() {
    logger.debug('[ToolCommand.execEdit]', 'editing a custom tool...');

    // ask for the tool name
    const name = this.args[1] || await input({
      message: 'Tool name (e.g. web_search):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid tool name (use a-z, 0-9, _ and -)',
    });
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      logger.error('[ToolCommand.execEdit]', 'invalid tool name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // the tool must exist in the workspace
    const tpath = join(this.engine.work, 'tools', `${name}.ts`);
    if (!existsSync(tpath)) {
      logger.error('[ToolCommand.execEdit]', `tool "${name}" not found in ~/.marvin/tools`);
      return;
    }
    const current = readFileSync(tpath, 'utf8');

    // ask for what to change
    const description = this.args.slice(2).join(' ') || await input({ message: 'What should change about the tool?', required: true });
    if (!description) {
      logger.error('[ToolCommand.execEdit]', 'no description provided, exiting');
      return;
    }

    // load the tools-edit skill that teaches how to edit tools
    let instructions: string;
    try {
      instructions = readSkill(loadSkill(this.engine, 'tools-edit'));
    } catch {
      logger.error('[ToolCommand.execEdit]', 'the "tools-edit" skill was not found, cannot edit tools');
      return;
    }

    // load the engine (models + agents) so we can prompt the LLM
    // await this.engine.load();

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
      logger.error('[ToolCommand.execEdit]', 'no result from the LLM');
      return;
    }
    
    // resolve the MARVIN_ROOT placeholder the skill keeps literal in the tool import
    let content = result.content.trim().replaceAll('{MARVIN_ROOT}', this.engine.root);

    // persist the edited tool back to ~/.marvin/tools/<name>.ts
    writeFileSync(tpath, content + '\n');
    
    // reload
    this.engine.tools = {};
    await this.engine.loadTools();

    logger.info(`tool "${name}" updated, saved to ${tpath}`);
  }
}
