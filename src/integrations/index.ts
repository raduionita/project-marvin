import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

import type Engine from '../engine.js';
import logger from '../logger.js';
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
    return new Class(engine, config);
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
      logger.warn('[buildIntegrationTools]', `integration "${id}" not loaded, skipping`);
      continue;
    }

    const config = integration.config || {};
    const toolCfg = config.tools || {};
    const hasConfigured = Object.keys(toolCfg).length > 0;

    for (const [tool, description] of Object.entries(integration.meta.tools)) {
      const cfg = toolCfg[tool];
      // when any tools is configured, expose only the configured (enabled) ones
      if (hasConfigured && (!cfg || cfg.enabled === false)) continue;

      // configured fields (OPTIONS snapshot) drive the tool schema; fall back to
      // live discovery (best effort, never blocks the task loop)
      let fields = toolParameters(config, tool).properties;
      if (!Object.keys(fields).length) {
        try {
          const discovered = await integration.discover(tool);
          fields = Object.fromEntries(discovered.map(f => [f.name, f]));
        } catch (err) {
          logger.warn('[buildIntegrationTools]', `discovery failed for "${id}" "${tool}":`, (err as Error).message);
        }
      }

      tools.push(makeIntegrationTool(id, integration, tool, description, Object.values(fields)));
    }
  }
  return tools;
}

// tool names for per-tool integration tools follow `<integrationId>__<tool>`
export function makeIntegrationToolName(id: string, tool: string): string {
  return `${id}__${tool}`;
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

// build the parameters for a single tool from the configured fields (a
// snapshot of live OPTIONS discovery taken by `marvin integrations add`), plus
// any custom meta/acf fields configured on the integration
function toolParameters(config: { [key: string]: any }, tool: string): { properties: { [key: string]: any }, required: string[] } {
  const properties: { [key: string]: any } = {};
  const required: string[] = [];

  const fieldsCfg = config.tools?.[tool]?.fields as { [key: string]: { type?: string, required?: boolean, description?: string, enum?: string[] } } | undefined;
  if (fieldsCfg && typeof fieldsCfg === 'object') {
    for (const [name, def] of Object.entries(fieldsCfg)) {
      if (!def) continue;
      setNested(properties, name.split('.'), fieldToProperty(def));
      if (def.required === true) required.push(name.split('.')[0]!);
    }
  }

  // custom meta/acf fields are available to every tool
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

// build the ToolMeta for a single integration tool
function makeIntegrationTool(integrationId: string, integration: Integration, tool: string, description: string, fields: Field[]): ToolMeta {
  const config = integration.config || {};
  const { properties, required } = toolParameters(config, tool);

  // fall back to discovered fields when the config has none configured
  for (const f of fields) {
    if (properties[f.name]) continue;
    properties[f.name] = fieldToProperty(f);
    if (f.required) required.push(f.name);
  }

  return {
    type: 'function',
    group: 'integration',
    function: {
      name: makeIntegrationToolName(integrationId, tool),
      description: `Run "${tool}" on the "${integrationId}" integration: ${description}`,
      parameters: {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
      },
    },
  };
}
