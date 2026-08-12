import { join } from 'path';
import { writeFileSync } from 'fs';
import { promises } from 'readline';

import { Command } from "../types";
import { listIntegrations, loadIntegration } from '../integrations';

// `marvin integrations [command] [--dry]` list, add, drop integrations
export default class IntegrationsCommand extends Command {
  async exec() {
    console.debug('[IntegrationsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        console.warn('[IntegrationsCommand.exec]', 'unknown command: integrations', cmd);
      case 'help':
        await this.execHelp();
      break;
      // list configured integrations
      case 'list':
        await this.execList();
      break;
      // add a new integration
      case 'add':
        await this.execAdd();
      break;
      // drop an integration
      case 'drop':
        await this.execDrop();
      break;
    }

    console.debug('[IntegrationsCommand.exec]', `done`);
  }

  // `marvin integrations help`
  async execHelp() {
    console.info('usage: marvin integrations [command]');
    console.info('commands:');
    console.info('  help              ', 'show this help');
    console.info('  list              ', 'list configured integrations');
    console.info('  add <name> [type] ', 'add an integration (prompts for missing values)');
    console.info('  drop <name>       ', 'drop an integration');
  }

  // `marvin integrations list`
  async execList() {
    console.debug('[IntegrationsCommand.execList]');
    console.info('integrations:');
    const configured = Object.keys(this.engine.config.integrations).length;
    if (configured === 0) {
      console.info('  (none)');
    }
    for (const [id, config] of Object.entries(this.engine.config.integrations)) {
      console.info(`  ${id}`);
      console.info('  - type:', config.type);
      console.info('  - enabled:', config.enabled);
      for (const [key, value] of Object.entries(config)) {
        if (key === 'type' || key === 'enabled') continue;
        console.info(`  - ${key}:`, value);
      }
    }
  }

  // `marvin integrations add [name] [type]`
  async execAdd() {
    console.info('[IntegrationsCommand.execAdd]', 'adding an integration...');

    // available integration types (files in src/integrations)
    const types = listIntegrations(this.engine).map(c => c.replace('.ts', ''));

    console.log('');
    const pli = promises.createInterface({input: process.stdin, output: process.stdout, });

    // ask for the integration name
    let name = this.args[1] || await pli.question('Enter integration name (e.g. gloobeam): ') as string;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      console.error('[IntegrationsCommand.execAdd]', 'invalid name (use a-z, 0-9, _ and -):', name);
      pli.close();
      return;
    }

    // check if the integration is already configured
    if (this.engine.config.integrations[name]) {
      console.warn('[IntegrationsCommand.execAdd]', `integration "${name}" is already configured`);
      pli.close();
      return;
    }

    // ask for the type
    const type = this.args[2] || await pli.question(`Enter integration type (${types.join(', ')}): `) as string;
    if (!types.includes(type)) {
      console.error('[IntegrationsCommand.execAdd]', `unknown integration type "${type}"`);
      console.error('[IntegrationsCommand.execAdd]', 'available types:', types.join(', '));
      pli.close();
      return;
    }

    // load the integration to get it's args/placeholders
    const config: { [key: string]: string } = { type };
    const integration = await loadIntegration(this.engine, type, config);
    if (!integration) {
      console.error('[IntegrationsCommand.execAdd]', `integration type "${type}" did not load`);
      pli.close();
      return;
    }

    // ask for each arg value
    for (const [key, placeholder] of Object.entries(integration.args)) {
      config[key] = await pli.question(`Enter ${type} ${key} (${placeholder}): `) as string;
    }

    pli.close();
    console.log('');

    // register the integration in config
    this.engine.config.integrations[name] = { enabled: true, type, ...config };

    // run load to see if the integration works
    await integration.load();
    await integration.drop();

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');

    // write to config file
    if (this.engine.isDry) {
      console.info('[IntegrationsCommand.execAdd]', '[dry]',`would configure integration ${name}, config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    console.info('[IntegrationsCommand.execAdd]', `integration "${name}" (${type}) configured, config persisted to ${cpath}`);
  }

  // `marvin integrations drop [name]`
  async execDrop() {
    console.info('[IntegrationsCommand.execDrop]', 'dropping an integration...');

    const pname = this.args[1];
    if (!pname) {
      console.warn('[IntegrationsCommand.execDrop]', 'usage: marvin integrations drop <name>');
      return;
    }

    if (!this.engine.config.integrations[pname]) {
      console.error('[IntegrationsCommand.execDrop]', `integration "${pname}" not found in config`);
      return;
    }

    // drop the integration from the engine if loaded
    await this.engine.dropIntegration(pname);

    delete this.engine.config.integrations[pname];

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      console.info('[IntegrationsCommand.execDrop]', '[dry]', `would drop integration ${pname}, config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    console.info('[IntegrationsCommand.execDrop]', `integration "${pname}" dropped, config persisted to ${cpath}`);
  }
}