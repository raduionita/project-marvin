import { join } from 'path';
import { writeFileSync } from 'fs';

import { Command } from "../types";
import { listIntegrations, loadIntegration } from '../integrations';
import { select, multiselect, ask } from '../terminal';
import { Option, Field } from '../types';

// `marvin integrations [command] [--dry]` list, add, drop integrations
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

    this.logger.debug('[IntegrationsCommand.exec]', `done`);
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
    const configured = Object.keys(this.engine.config.integrations).length;
    if (configured === 0) {
      this.logger.log('  (none)');
    }
    for (const [id, config] of Object.entries(this.engine.config.integrations)) {
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
    const types = listIntegrations(this.engine).map(c => c.replace('.ts', ''));

    // ask for the integration name
    let name = this.args[1] || await ask('Enter integration name (e.g. mycoolsite): ');
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.logger.error('[IntegrationsCommand.execAdd]', 'invalid name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // check if the integration is already configured
    if (this.engine.config.integrations[name]) {
      this.logger.error('[IntegrationsCommand.execAdd]', `integration "${name}" is already configured`);
      return;
    }

    // ask for the type (radio select from the available types)
    const type = this.args[2] || await select('Select integration type:', types.map(t => ({ label: t, value: t }) as Option<string>), ask);
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
    for (const [key, placeholder] of Object.entries(integration.args)) {
      config[key] = await ask(`Enter ${type} ${key} (${placeholder}): `);
    }

    // ask for the actions and their fields in a loop (until the user is done)
    const actionsCfg: { [key: string]: any } = {};
    const actionOptions: Option<string>[] = integration.meta.actions.map(a => ({
      label: `${a.name} - ${a.description}`,
      value: a.name,
    }));

    while (actionOptions.length) {
      this.logger.log('');
      const action = await select(`Select an action for "${name}" (or finish to stop):`, [...actionOptions, { label: 'finish (done adding actions)', value: '' }], ask);
      if (!action) break;

      // discover the available fields for this action (OPTIONS request)
      let fields: Field[] = [];
      try {
        fields = await integration.discover(action);
      } catch (err) {
        this.logger.error('[IntegrationsCommand.execAdd]', 'discovery failed for', action, ':', (err as Error).message);
        return;
      }
      if (!fields.length) {
        this.logger.error('[IntegrationsCommand.execAdd]', `no fields found for action "${action}"`);
        return;
      }

      // ask which fields to use (checkbox select), marked ones are sent
      const fieldOptions: Option<string>[] = fields.map(f => ({
        label: `${f.name} (${f.type})${f.required ? ' [required]' : ''} - ${f.description}${f.enum ? ` [${f.enum.join(', ')}]` : ''}`,
        value: f.name,
      }));
      const picked = await multiselect(`Select fields for "${name}" "${action}" (required ones are sent):`, fieldOptions, ask);
      const pickedSet = new Set(picked || []);

      // ask which of the picked fields are required
      const requiredNames = fields.filter(f => pickedSet.has(f.name)).map(f => f.name);
      const requiredRaw = await ask(`Mark required fields (comma-separated, enter = all selected): `);
      const requiredSet = new Set(
        requiredRaw.trim()
          ? requiredRaw.split(',').map(s => s.trim()).filter(Boolean)
          : requiredNames
      );

      const fieldsCfg: { [key: string]: any } = {};
      for (const f of fields) {
        if (!pickedSet.has(f.name)) continue;
        fieldsCfg[f.name] = {
          type: f.type,
          required: requiredSet.has(f.name),
          description: f.description,
          ...(f.enum ? { enum: f.enum } : {}),
        };
      }
      actionsCfg[action] = { enabled: true, fields: fieldsCfg };

      // keep offering the remaining actions
      const idx = actionOptions.findIndex(o => o.value === action);
      if (idx !== -1) actionOptions.splice(idx, 1);
    }

    if (Object.keys(actionsCfg).length) {
      config.actions = actionsCfg;
    }

    // ask for custom meta fields (site specific, not discoverable via OPTIONS)
    const metaFields: { [key: string]: any } = {};
    this.logger.log('');
    this.logger.info('[IntegrationsCommand.execAdd]', 'optional: add custom meta fields (e.g. ACF fields on gloobeam)');
    while (true) {
      const mname = await ask('Enter a custom meta field name (blank to stop): ');
      if (!mname.trim()) break;
      const mtype = await ask(`  type for "${mname}" (string/number/boolean, enter=string): `) || 'string';
      const mdesc = await ask(`  description for "${mname}": `);
      metaFields[mname] = { type: mtype, required: false, description: mdesc };
    }
    if (Object.keys(metaFields).length) {
      const metaTarget = await ask('Meta target (meta or acf, enter=meta): ') || 'meta';
      config.meta = { target: metaTarget, fields: metaFields };
    }

    this.logger.log('');

    // register the integration in config
    this.engine.config.integrations[name] = { enabled: true, type, ...config };

    // run load to see if the integration works
    await integration.load();
    await integration.drop();

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');

    // write to config file
    if (this.engine.isDry) {
      this.logger.info('[IntegrationsCommand.execAdd]', '[dry]',`would configure integration ${name}, config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    this.logger.info('[IntegrationsCommand.execAdd]', `integration "${name}" (${type}) configured, config persisted to ${cpath}`);
  }

  // `marvin integrations info [name]`
  async execInfo() {
    this.logger.debug('[IntegrationsCommand.execInfo]');

    const pname = this.args[1];
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

    // run discovery for every action and preview the resulting config
    const actionsCfg: { [key: string]: any } = {};
    for (const a of integration.meta.actions) {
      let fields: Field[] = [];
      try {
        fields = await integration.discover(a.name);
      } catch (err) {
        this.logger.error('[IntegrationsCommand.execInfo]', 'discovery failed for', a.name, ':', (err as Error).message);
        return;
      }
      if (!fields.length) {
        this.logger.error('[IntegrationsCommand.execInfo]', `no fields found for action "${a.name}"`);
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
      actionsCfg[a.name] = { enabled: true, fields: fieldsCfg };
    }

    this.logger.log('');
    this.logger.info('[IntegrationsCommand.execInfo]', `config preview for "${pname}" (not persisted):`);
    this.logger.info(JSON.stringify({ ...config, actions: actionsCfg }, null, 2));
  }

  // `marvin integrations edit [name]`
  async execEdit() {
    this.logger.debug('[IntegrationsCommand.execEdit]');

    // TODO: add ask here
    const pname = this.args[1];
    if (!pname) {
      this.logger.warn('[IntegrationsCommand.execEdit]', 'usage: marvin integrations edit <name>');
      return;
    }

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
    const actionsCfg = (config.actions as { [key: string]: any }) || {};

    const current = Object.keys(actionsCfg).length
      ? Object.keys(actionsCfg)
      : (info.actions.map(a => a.name).length ? [info.actions[0]!.name] : []);
    const action = await select(`Select an action to edit for "${pname}" (current: ${current.join(', ') || 'none'}):`, info.actions.map(a => ({ label: `${a.name} - ${a.description}`, value: a.name }) as Option<string>), ask);
    if (!action) return;

    let fields: Field[] = [];
    try {
      fields = await integration.discover(action);
    } catch (err) {
      this.logger.error('[IntegrationsCommand.execEdit]', 'discovery failed for', action, ':', (err as Error).message);
      return;
    }
    if (!fields.length) {
      this.logger.error('[IntegrationsCommand.execEdit]', `no fields found for action "${action}"`);
      return;
    }

    // pre-select the currently configured fields
    const currentFields = actionsCfg[action]?.fields as { [key: string]: any } | undefined;
    const prePicked = currentFields ? Object.keys(currentFields) : fields.filter(f => f.required).map(f => f.name);
    const picked = await multiselect(`Select fields for "${pname}" "${action}" (current: ${prePicked.join(', ') || 'none'}):`, fields.map(f => ({ label: `${f.name} (${f.type})${f.required ? ' [required]' : ''} - ${f.description}`, value: f.name }) as Option<string>), ask) || prePicked;
    const pickedSet = new Set(picked);

    const requiredRaw = await ask('Mark required fields (comma-separated, enter = all selected): ');
    const requiredSet = new Set(requiredRaw.trim() ? requiredRaw.split(',').map(s => s.trim()).filter(Boolean) : Array.from(pickedSet));

    const fieldsCfg: { [key: string]: any } = {};
    for (const f of fields) {
      if (!pickedSet.has(f.name)) continue;
      fieldsCfg[f.name] = {
        type: f.type,
        required: requiredSet.has(f.name),
        description: f.description,
        ...(f.enum ? { enum: f.enum } : {}),
      };
    }
    actionsCfg[action] = { enabled: true, fields: fieldsCfg };
    config.actions = actionsCfg;

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      this.logger.info('[IntegrationsCommand.execEdit]', '[dry]', `would update integration ${pname}, config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }
    this.logger.info('[IntegrationsCommand.execEdit]', `integration "${pname}" updated, config persisted to ${cpath}`);
  }

  // `marvin integrations drop [name]`
  async execDrop() {
    this.logger.info('[IntegrationsCommand.execDrop]', 'dropping an integration...');

    const pname = this.args[1];
    if (!pname) {
      this.logger.warn('[IntegrationsCommand.execDrop]', 'usage: marvin integrations drop <name>');
      return;
    }

    if (!this.engine.config.integrations[pname]) {
      this.logger.error('[IntegrationsCommand.execDrop]', `integration "${pname}" not found in config`);
      return;
    }

    // drop the integration from the engine if loaded
    await this.engine.dropIntegration(pname);

    delete this.engine.config.integrations[pname];

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      this.logger.info('[IntegrationsCommand.execDrop]', '[dry]', `would drop integration ${pname}, config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    this.logger.info('[IntegrationsCommand.execDrop]', `integration "${pname}" dropped, config persisted to ${cpath}`);
  }
}
