import { readdirSync } from 'node:fs';
import { Config } from '../types.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Engine from '../engine.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

let models: string[] = [];

export function listModels(engine: Engine): string[] {
  if (models.length) return models;
  return models = readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  ).map(f => f.replace('.ts$', ''));
}
