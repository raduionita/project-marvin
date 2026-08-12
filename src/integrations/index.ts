import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

import type Engine from '../engine.js';
import { Integration } from '../types.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listIntegrations(engine: Engine): string[] {
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  );
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