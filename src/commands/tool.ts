import { tryJsonParse } from "../helpers";
import { listSystems } from "../systems";
import { listTools } from "../tools";
import { Command, System, Tool, ToolMeta } from "../types";

export default class ToolCommand extends Command {
  async load() {
    console.debug('[ToolCommand.load]');

    const cmds = process.argv.slice(2);
    const name = cmds[1] || 'help';

    switch (name) {
      case 'help':
        console.debug('[ToolCommand.load]', 'usage: marvin tool [name] [params] [--dry]', 'call a tool');
        console.debug('[ToolCommand.load]', 'commands:');
        console.debug('[ToolCommand.load]', '  help    ', 'show this help');
        console.debug('[ToolCommand.load]', '  list    ', 'list available tools, for each one, it\'s connected agents');
        console.debug('[ToolCommand.load]', '  [name]  ', 'call a tool');
      break;
      case 'list':
        // for each tool, list enabled agents
        await this.listTools();
      break;
      default:
        // laod systems
        await this.loadSystems();
        // params
        const params = tryJsonParse(cmds.slice(2).join(' ')) as { [key: string]: any };
        // load tool
        await this.callTool(name, params);
      break;
    }
  }

  async listTools() {
    console.debug('[ToolCommand.listTools]', 'tools:');
    const files = listTools(this.ctx).map(f => f.replace('.ts', ''));
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
        const instance = new Class(this.ctx);
        const meta = instance.meta as ToolMeta;
        this.ctx.tools[meta.function.name] = instance;
        console.info('[ToolCommand.listTools]', `  tool [${meta.function.name}]`, JSON.stringify(meta.function.parameters.properties));
      } catch (err) {
        console.error('[ToolCommand.listTools]', `failed to load ${file}:`, err);
      }
    }
  }

  async callTool(name: string, params: { [key: string]: any } = {}) {
    console.debug('[ToolCommand.callTool]', name, JSON.stringify(params));
    try {
      // load tool
      const Module = await import(`../tools/${name}.js`);
      const Class = Module.default;
      if (!Class || !(Class.prototype instanceof Tool)) {
        console.error('[ToolCommand.callTool]', `${name} does not export a Tool class, skipping`);
        throw new Error(`[ToolCommand.callTool] ERROR - ${name} does not export a Tool class`);
      }
      // register instance of Tool
      const instance = new Class(this.ctx);
      // dry guard
      if (this.ctx.isDry) {
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


  async loadSystems() {
    console.debug('[ToolCommand.loadSystems]');

    const files = listSystems(this.ctx).map(f => f.replace('.ts', ''));
    for (const name of files) {
      try {
        const Module = await import(`../systems/${name}.js`);
        const Class = Module.default;
        if (!Class || !(Class.prototype instanceof System)) {
          console.error('[ToolCommand.loadSystems]', `${name} does not export a System class, skipping`);
          continue;
        }
        // register instance of System
        const instance = new Class(this.ctx);
        await instance.load();
        this.ctx.systems[name] = instance;
        console.debug('[ToolCommand.loadSystems]', `system [${name}] loaded`);
      } catch (err) {
        console.error('[ToolCommand.loadSystems]', `failed to load ${name}:`, err);
        process.exit(1);
      }
    }
  }

  async dropSystems() {
    console.log('[ToolCommand.dropSystems]');
    const ctx = this.ctx;
    for (const system of Object.values(ctx.systems)) {
      try {
        await system.drop();
      } catch (err) {
        console.error('[ToolCommand.dropSystems]', `error detaching system:`, err);
      }
    }
    ctx.systems = {};
  }

  async drop() {
    console.debug('[ToolCommand.drop]');
    await this.dropSystems();
  }
}
