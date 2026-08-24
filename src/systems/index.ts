import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';
import type Engine from '../engine';
import { System } from '../types.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

const systems: string[] = [];

export function listSystems(engine: Engine): string[] {
  if (systems.length) return systems;
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  ).map(f => f.replace('.ts', ''));
}

// loadSystem loads a System instance by name
export async function loadSystem(engine: Engine, name: string): Promise<System> {
  const ipath = join(tdir, `${name}.ts`);
  try {
    if (!existsSync(ipath)) {
      throw new Error(`system "${name}" not found`);
    }
    const Module: any = await import(`./${name}.js`);
    const Class = Module.default;
    if (!Class || !(Class.prototype instanceof System)) {
      throw new Error(`"${name}" does not export a System class`);
    }
    return new Class(engine, engine.logger);
  } catch (err) {
    throw new Error(`failed to load system "${name}"`, { cause: err });
  }
}
