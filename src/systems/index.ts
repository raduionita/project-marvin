import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';
import type Engine from '../engine';

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
