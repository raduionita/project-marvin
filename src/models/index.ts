import { readdirSync } from 'node:fs';
import { Config, Context } from '../types.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type ModelConfig = Config['models'][string];

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listModels(ctx: Context): string[] {
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (ctx.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  );
}
