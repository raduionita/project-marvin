import { readdirSync } from 'node:fs';
import { Config } from '../types.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Engine from '../engine.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listModels(engine: Engine): string[] {
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  );
}
