import { readFileSync, writeFileSync } from 'fs';
import { Tool, ToolMeta } from '../types.js';
import { safeJoin } from '../helpers.js';

function getByPath(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
}

function setByPath(obj: Record<string, any>, path: string, value: unknown): boolean {
  const parts = path.split('.');
  let acc = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined) return false;
    if (typeof acc[part] !== 'object' || acc[part] === null) acc[part] = {};
    acc = acc[part];
  }
  const last = parts[parts.length - 1];
  if (!last) return false;
  acc[last] = value;
  return true;
}

function parseValue(raw: any): any {
  if (typeof raw !== 'string') return raw;
  if (raw === '') return '';
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export default class MarvinConfigTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'marvin_config',
      description: 'Read or edit the Marvin config file (~/.marvin/marvin.json). Default reads the whole config; pass "key" for a dotted path. Use operation "set" with "key" and "value" (JSON or string) to persist a value.',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            description: '"get" (default) or "set"',
          },
          key: {
            type: 'string',
            description: 'Dotted path into the config, e.g. "settings.name" or "models.my-model.enabled"',
          },
          value: {
            type: 'string',
            description: 'New value for the key when using "set" (JSON-parsed, falls back to string)',
          },
        },
        required: [],
      }
    },
  }

  public async call(args: { operation?: string; key?: string; value?: any }) {
    this.logger.debug('[MarvinConfigTool.call]', args);

    const path = safeJoin(this.engine.work, 'marvin.json');

    let config: Record<string, any>;
    try {
      config = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      return { error: `marvin_config: could not read config: ${(err as Error).message}` };
    }

    const operation = args?.operation || 'get';

    if (operation === 'set') {
      const key = args?.key || '';
      if (!key) {
        return { error: 'marvin_config: a "key" is required for "set"' };
      }

      if (!setByPath(config, key, parseValue(args?.value))) {
        return { error: `marvin_config: invalid key "${key}"` };
      }

      try {
        writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      } catch (err) {
        return { error: `marvin_config: could not write config: ${(err as Error).message}` };
      }

      // keep in-memory config in sync (a later reload will re-read from disk)
      this.engine.config = config as typeof this.engine.config;

      return { path, ok: true, key, value: config };
    }

    if (args?.key) {
      return { key: args.key, value: getByPath(config, args.key) };
    }

    return { path, config };
  }
}
