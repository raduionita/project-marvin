import { checkbox, input, password, rawlist, select } from '../terminal.js';
import { join } from 'path';
import { writeFileSync } from 'fs';

import { Command } from "../types";
import { listIntegrations, loadIntegration } from '../integrations';
import { Field } from '../types';

// flatten a Field tree into dotted paths (e.g. meta.keywords) so the wizard can
// list and select sub-fields of object/array types individually
function flattenFields(fields: Field[], prefix = ''): { name: string, type: string, required: boolean, description: string, enum?: string[] }[] {
  const out: { name: string, type: string, required: boolean, description: string, enum?: string[] }[] = [];
  for (const f of fields) {
    const name = prefix ? `${prefix}.${f.name}` : f.name;
    out.push({ name, type: f.type, required: f.required, description: f.description, ...(f.enum ? { enum: f.enum } : {}) });
    if (f.properties) out.push(...flattenFields(Object.values(f.properties), name));
  }
  return out;
}

// `marvin integrations [command]` list, add, drop integrations
export default class IntegrationsCommand extends Command {
  async exec() {
    this.logger.debug('[IntegrationsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        this.logger.warn('[IntegrationsCommand.exec]', 'unknown command: integrations', cmd);
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
      // preview the config that discovery would produce (no changes)
      case 'info':
        await this.execInfo();
      break;
      // edit an integration (fields/meta, without re-adding)
      case 'edit':
        await this.execEdit();
      break;
      // drop an integration
      case 'drop':
        await this.execDrop();
      break;
    }
  }

  // `marvin integrations help`
  async execHelp() {
    this.logger.log('usage: marvin integrations [command]');
    this.logger.log('commands:');
    this.logger.log('  help              ', 'show this help');
    this.logger.log('  list              ', 'list configured integrations');
    this.logger.log('  add <name> [type] ', 'add an integration (discovery wizard)');
    this.logger.log('  info <name>       ', 'preview the config discovery would produce (no changes)');
    this.logger.log('  edit <name>       ', 'edit the fields/meta of an integration');
    this.logger.log('  drop <name>       ', 'drop an integration');
  }

  // `marvin integrations list`
  async execList() {
    this.logger.debug('[IntegrationsCommand.execList]');
    this.logger.log('integrations:');
    const integrations = this.engine.config.integrations || {};
    const configured = Object.keys(integrations).length;
    if (configured === 0) {
      this.logger.log('  (none)');
    }
    for (const [id, config] of Object.entries(integrations)) {
      this.logger.log(`  ${id}`);
      this.logger.log('  - type:', config.type);
      this.logger.log('  - enabled:', config.enabled);
      for (const [key, value] of Object.entries(config)) {
        if (key === 'type' || key === 'enabled') continue;
        this.logger.log(`  - ${key}:`, value);
      }
    }
  }

  // `marvin integrations add [name] [type]`
  async execAdd() {
    this.logger.debug('[IntegrationsCommand.execAdd]', 'adding an integration...');

    // available integration types (files in src/integrations)
    const types = listIntegrations(this.engine);

    // ask for the integration name
    let name = this.args[1] || await input({
      message: 'Enter integration name (e.g. mycoolsite):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid name (use a-z, 0-9, _ and -)',
    });
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.logger.error('[IntegrationsCommand.execAdd]', 'invalid name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // must NOT exist
    if (this.engine.config.integrations[name]) {
      this.logger.error('[IntegrationsCommand.execAdd]', `integration "${name}" is already configured`);
      return;
    }

    // ask for the type (radio select from the available types)
    const type = this.args[2] || await select({
      message: 'Select integration type:',
      choices: types.map(t => ({ name: t, value: t })),
    });
    if (!type) {
      this.logger.error('[IntegrationsCommand.execAdd]', 'no integration type selected');
      return;
    }

    // selected type is not available
    if (!types.includes(type)) {
      this.logger.error('[IntegrationsCommand.execAdd]', `unknown type "${type}".`, 'available types:', types.join(', '));
      return;
    }

    // load the integration to get its args/placeholders
    const config: { [key: string]: any } = { type };
    const integration = await loadIntegration(this.engine, type, config);
    if (!integration) {
      this.logger.error('[IntegrationsCommand.execAdd]', `integration type "${type}" did not load`);
      return;
    }

    // ask for each arg value (url, credentials, ...)
    for (const [key, placeholder] of Object.entries(integration.meta.arguments)) {
      config[key] = await input({ 
        message: `Enter ${type}.${key} (${placeholder}):`,
        required: true,
      });
    }

    // ask for the tools and their fields in a loop (until the user is done)
    const toolsCfg: { [key: string]: any } = {};
    const toolOptions = Object.entries(integration.meta.tools).map(([name, description]) => ({
      name: `${name} - ${description}`,
      value: name,
    }));

    while (toolOptions.length) {
      this.logger.log('');
      const tool = await rawlist({
        message: `Select an tool for "${name}" (or finish to stop):`,
        choices: [...toolOptions, { name: 'finish (done adding tools)', value: '' }],
      });
      if (!tool) break;

      // discover the available fields for this tool (OPTIONS request)
      let fields: Field[] = [];
      try {
        fields = await integration.discover(tool);
      } catch (err) {
        this.logger.error('[IntegrationsCommand.execAdd]', 'discovery failed for', tool, ':', (err as Error).message);
        return;
      }
      if (!fields.length) {
        this.logger.error('[IntegrationsCommand.execAdd]', `no fields found for tool "${tool}"`);
        return;
      }

      // ask which fields to use (checkbox select), marked ones are sent;
      // picking an object/array field includes its sub-fields
      const picked = await checkbox({
        message: `Select fields for "${name}" "${tool}" (required ones are sent):`,
        choices: fields.map(f => ({
          name: `${f.name} (${f.type})${f.required ? ' [required]' : ''} - ${f.description}${f.enum ? ` [${f.enum.join(', ')}]` : ''}`,
          value: f.name,
        })),
      });
      const pickedSet = new Set(picked || []);
      const pickedFields = flattenFields(fields.filter(f => pickedSet.has(f.name)));

      // ask which of the picked fields are required (all are checked by default)
      const requiredSet = new Set(pickedFields.length
        ? await checkbox({
            message: `Mark required fields for "${name}" "${tool}":`,
            choices: pickedFields.map(f => ({
              name: `${name}.${f.name} (${f.type}):`,
              value: f.name,
              checked: true,
            })),
          })
        : []);

      const fieldsCfg: { [key: string]: any } = {};
      for (const f of pickedFields) {
        fieldsCfg[f.name] = {
          type: f.type,
          required: requiredSet.has(f.name),
          description: f.description,
          ...(f.enum ? { enum: f.enum } : {}),
        };
      }
      toolsCfg[tool] = { enabled: true, fields: fieldsCfg };

      // keep offering the remaining tools
      const idx = toolOptions.findIndex(o => o.value === tool);
      if (idx !== -1) toolOptions.splice(idx, 1);
    }

    if (Object.keys(toolsCfg).length) {
      config.tools = toolsCfg;
    }

    // ask for custom meta fields (site specific, not discoverable via OPTIONS)
    const metaFields: { [key: string]: any } = {};
    this.logger.log('');
    this.logger.info('optional: add custom meta fields (e.g. ACF fields on gloobeam)');
    while (true) {
      const mname = await input({ message: 'Enter a custom meta field name (blank to stop):' });
      if (!mname.trim()) break;
      const mtype = await select({
        message: `Type for "${mname}" (default string):`,
        choices: [
          { name: 'string', value: 'string' },
          { name: 'number', value: 'number' },
          { name: 'boolean', value: 'boolean' },
        ],
        default: 'string',
      });
      const mdesc = await input({ message: `  description for "${mname}":` });
      metaFields[mname] = { type: mtype, required: false, description: mdesc };
    }
    if (Object.keys(metaFields).length) {
      const metaTarget = await select({
        message: 'Meta target (default meta):',
        choices: [
          { name: 'meta', value: 'meta' },
          { name: 'acf', value: 'acf' },
        ],
        default: 'meta',
      });
      config.meta = { target: metaTarget, fields: metaFields };
    }

    this.logger.log('');

    // register the integration in config (tools now load lazily via load_tools)
    this.engine.config.integrations[name] = { enabled: true, type, ...config };

    // run load to see if the integration works
    await integration.load();
    await integration.drop();

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');

    // write to config file
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

    this.logger.info('[IntegrationsCommand.execAdd]', `integration "${name}" (${type}) configured, config persisted to ${cpath}`);
  }

  // `marvin integrations info [name]`
  async execInfo() {
    this.logger.debug('[IntegrationsCommand.execInfo]');

    const pname = this.args[1] || await input({ message: 'Enter integration name (e.g. mycoolsite):' });
    if (!pname) {
      this.logger.warn('[IntegrationsCommand.execInfo]', 'usage: marvin integrations info <name>');
      return;
    }

    const config = this.engine.config.integrations[pname];
    if (!config) {
      this.logger.error('[IntegrationsCommand.execInfo]', `integration "${pname}" not found in config`);
      return;
    }

    const integration = await loadIntegration(this.engine, config.type, config);
    if (!integration) {
      this.logger.error('[IntegrationsCommand.execInfo]', `integration type "${config.type}" did not load`);
      return;
    }

    // run discovery for every tool and preview the resulting config
    const tools: { [key: string]: any } = {};
    for (const name of Object.keys(integration.meta.tools)) {
      let fields: Field[] = [];
      try {
        fields = await integration.discover(name);
      } catch (err) {
        this.logger.error('[IntegrationsCommand.execInfo]', 'discovery failed for', name, ':', (err as Error).message);
        return;
      }
      if (!fields.length) {
        this.logger.error('[IntegrationsCommand.execInfo]', `no fields found for tool "${name}"`);
        return;
      }
      const fieldsCfg: { [key: string]: any } = {};
      for (const f of fields) {
        fieldsCfg[f.name] = {
          type: f.type,
          required: f.required,
          description: f.description,
          ...(f.enum ? { enum: f.enum } : {}),
        };
      }
      tools[name] = { enabled: true, fields: fieldsCfg };
    }

    this.logger.info(`config preview for "${pname}" (not persisted):`);
    this.logger.info(JSON.stringify({ ...config, tools: tools }, null, 2));
  }

  // `marvin integrations edit [name]`
  async execEdit() {
    this.logger.debug('[IntegrationsCommand.execEdit]');

    // TODO: add ask here
    const pname = this.args[1] || await input({
      message: 'Enter integration name (e.g. mycoolsite):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid name (use a-z, 0-9, _ and -)',
    });
    if (!/^[a-zA-Z0-9_-]+$/.test(pname)) {
      this.logger.error('[IntegrationsCommand.execEdit]', 'invalid name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // must exist
    const config = this.engine.config.integrations[pname];
    if (!config) {
      this.logger.error('[IntegrationsCommand.execEdit]', `integration "${pname}" not found in config`);
      return;
    }

    const integration = await loadIntegration(this.engine, config.type, config);
    if (!integration) {
      this.logger.error('[IntegrationsCommand.execEdit]', `integration type "${config.type}" did not load`);
      return;
    }

    const info = integration.meta;
    const toolsCfg = (config.tools as { [key: string]: any }) || {};

    const current = Object.keys(toolsCfg).length
      ? Object.keys(toolsCfg)
      : (Object.keys(info.tools).length ? [Object.keys(info.tools)[0]!] : []);
    const tool = await select({
      message: `Select an tool to edit for "${pname}" (current: ${current.join(', ') || 'none'}):`,
      choices: Object.entries(info.tools).map(([name, description]) => ({ name: `${name} - ${description}`, value: name })),
    });
    if (!tool) return;

    let fields: Field[] = [];
    try {
      fields = await integration.discover(tool);
    } catch (err) {
      this.logger.error('[IntegrationsCommand.execEdit]', 'discovery failed for', tool, ':', (err as Error).message);
      return;
    }
    if (!fields.length) {
      this.logger.error('[IntegrationsCommand.execEdit]', `no fields found for tool "${tool}"`);
      return;
    }

    // pre-select the currently configured fields
    const currentFields = toolsCfg[tool]?.fields as { [key: string]: any } | undefined;
    const flat = flattenFields(fields);
    const prePicked = currentFields ? Object.keys(currentFields) : flat.filter(f => f.required).map(f => f.name);
    const picked = await checkbox({
      message: `Select fields for "${pname}" "${tool}" (current: ${prePicked.join(', ') || 'none'}):`,
      choices: flat.map(f => ({
        name: `${f.name} (${f.type})${f.required ? ' [required]' : ''} - ${f.description}`,
        value: f.name,
        checked: prePicked.includes(f.name),
      })),
    });
    const pickedSet = new Set(picked);
    const pickedFields = flat.filter(f => pickedSet.has(f.name));
    const requiredSet = new Set(pickedFields.length
      ? await checkbox({
          message: `Mark required fields for "${pname}" "${tool}":`,
          choices: pickedFields.map(f => ({
            name: `${pname}.${f.name} (${f.type}):`,
            value: f.name,
            checked: true,
          })),
        })
      : []);

    const fieldsCfg: { [key: string]: any } = {};
    for (const f of pickedFields) {
      fieldsCfg[f.name] = {
        type: f.type,
        required: requiredSet.has(f.name),
        description: f.description,
        ...(f.enum ? { enum: f.enum } : {}),
      };
    }
    toolsCfg[tool] = { enabled: true, fields: fieldsCfg };
    config.tools = toolsCfg;

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    
    this.logger.info('[IntegrationsCommand.execEdit]', `integration "${pname}" updated, config persisted to ${cpath}`);
  }

  // `marvin integrations drop [name]`
  async execDrop() {
    this.logger.info('[IntegrationsCommand.execDrop]', 'dropping an integration...');

    // pick from args, the configured integrations (rawList)
    let pname = this.args[1] || await rawlist({
      message: 'Select an integration to drop (or cancel):',
      choices: [
        ...Object.keys(this.engine.config.integrations).map(id => ({ name: id, value: id })),
        { name: 'cancel (type a name instead)', value: '' },
      ],
    });
    if (!pname) {
      this.logger.warn('[IntegrationsCommand.execDrop]', 'no integration selected');
      return;
    }

    if (!this.engine.config.integrations[pname]) {
      this.logger.error('[IntegrationsCommand.execDrop]', `integration "${pname}" not found in config`);
      return;
    }

    // TODO: send message to serve/engine, if running, to drop the integration

    // remove the integration from the config
    delete this.engine.config.integrations[pname];

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

    this.logger.info(`integration "${pname}" dropped, config ${cpath} updated`);
  }
}
