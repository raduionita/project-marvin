import { readdirSync } from 'node:fs';
import { Config } from '../types.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from '../types.js';

type ModelConfig = Config['models'][string];

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listModels(ctx: App): string[] {
  const context = (ctx as any).context || {};
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (context.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  );
}
