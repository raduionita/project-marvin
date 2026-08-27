import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

import type Engine from '../engine.js';
import { Field, Integration, ToolMeta } from '../types.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

let integrations: string[] = [];

export function listIntegrations(engine: Engine): string[] {
  if (integrations.length) return integrations;
  return integrations = readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  ).map(f => f.replace(/\.ts$/, ''));
}

export async function loadIntegration(engine: Engine, type: string, config: { [key: string]: any }): Promise<Integration | null> {
  try {
    const Module = await import(`./${type}.js`);
    const Class = Module.default;
    if (!Class || !(Class.prototype instanceof Integration)) {
      return null;
    }
    return new Class(engine, engine.logger, config);
  } catch {
    return null;
  }
}

// build the tool metas for a task's linked integrations. loaded dynamically at
// execTask time and merged with the engine (default) tools.
export async function loadIntegrationTools(engine: Engine, integrations: string[]): Promise<ToolMeta[]> {
  const tools: ToolMeta[] = [];
  for (const id of integrations || []) {
    const integration = engine.integrations[id];
    if (!integration) {
      engine.logger.warn('[buildIntegrationTools]', `integration "${id}" not loaded, skipping`);
      continue;
    }

    const config = integration.config || {};
    const actionsCfg = config.actions || {};
    const hasConfigured = Object.keys(actionsCfg).length > 0;

    for (const [action, description] of Object.entries(integration.meta.actions)) {
      const cfg = actionsCfg[action];
      // when any action is configured, expose only the configured (enabled) ones
      if (hasConfigured && (!cfg || cfg.enabled === false)) continue;

      // configured fields (OPTIONS snapshot) drive the tool schema; fall back to
      // live discovery (best effort, never blocks the task loop)
      let fields = actionParameters(config, action).properties;
      if (!Object.keys(fields).length) {
        try {
          const discovered = await integration.discover(action);
          fields = Object.fromEntries(discovered.map(f => [f.name, f]));
        } catch (err) {
          engine.logger.warn('[buildIntegrationTools]', `discovery failed for "${id}" "${action}":`, (err as Error).message);
        }
      }

      tools.push(makeActionTool(id, integration, action, description, Object.values(fields)));
    }
  }
  return tools;
}

// tool names for per-action integration tools follow `<integrationId>__<action>`
export function makeIntegrationToolName(id: string, action: string): string {
  return `${id}__${action}`;
}

// map a Field into a JSON-schema property for the tool parameters
function fieldToProperty(field: { type?: string, description?: string, enum?: string[], properties?: { [key: string]: Field } }): { [key: string]: any } {
  const type = field.type || 'string';
  const prop: { [key: string]: any } = {
    type,
    description: field.description || '',
  };
  if (field.enum?.length) prop.enum = field.enum;
  // object/array sub-fields become nested JSON-schema
  if (field.properties && Object.keys(field.properties).length) {
    const properties = Object.fromEntries(Object.entries(field.properties).map(([n, p]) => [n, fieldToProperty(p)]));
    if (type === 'array') prop.items = { type: 'object', properties };
    else prop.properties = properties;
  }
  return prop;
}

// set a (possibly dotted) parameter path in the tool schema, creating nested
// object levels as needed
function setNested(properties: { [key: string]: any }, parts: string[], prop: { [key: string]: any }) {
  const [head, ...rest] = parts;
  if (!rest.length) {
    properties[head!] = prop;
    return;
  }
  if (!properties[head!] || typeof properties[head!] !== 'object') properties[head!] = { type: 'object', properties: {} };
  if (!properties[head!].properties) properties[head!].properties = {};
  setNested(properties[head!].properties, rest, prop);
}

// build the parameters for a single action from the configured fields (a
// snapshot of live OPTIONS discovery taken by `marvin integrations add`), plus
// any custom meta/acf fields configured on the integration
function actionParameters(config: { [key: string]: any }, action: string): { properties: { [key: string]: any }, required: string[] } {
  const properties: { [key: string]: any } = {};
  const required: string[] = [];

  const fieldsCfg = config.actions?.[action]?.fields as { [key: string]: { type?: string, required?: boolean, description?: string, enum?: string[] } } | undefined;
  if (fieldsCfg && typeof fieldsCfg === 'object') {
    for (const [name, def] of Object.entries(fieldsCfg)) {
      if (!def) continue;
      setNested(properties, name.split('.'), fieldToProperty(def));
      if (def.required === true) required.push(name.split('.')[0]!);
    }
  }

  // custom meta/acf fields are available to every action
  const meta = config.meta as { fields?: { [key: string]: { type?: string, required?: boolean, description?: string } } } | undefined;
  if (meta?.fields && typeof meta.fields === 'object') {
    for (const [name, def] of Object.entries(meta.fields)) {
      if (!def || properties[name]) continue;
      properties[name] = fieldToProperty(def);
      if (def.required === true) required.push(name);
    }
  }

  return { properties, required };
}

// build the ToolMeta for a single integration action
function makeActionTool(integrationId: string, integration: Integration, action: string, description: string, fields: Field[]): ToolMeta {
  const config = integration.config || {};
  const { properties, required } = actionParameters(config, action);

  // fall back to discovered fields when the config has none configured
  for (const f of fields) {
    if (properties[f.name]) continue;
    properties[f.name] = fieldToProperty(f);
    if (f.required) required.push(f.name);
  }

  return {
    type: 'function',
    function: {
      name: makeIntegrationToolName(integrationId, action),
      description: `Run "${action}" on the "${integrationId}" integration: ${description}`,
      parameters: {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
      },
    },
  };
}
