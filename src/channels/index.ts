import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

import { App } from '../types.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listChannels(ctx: App): string[] {
  const context = (ctx as any).context || {};
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (context.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  );
}
