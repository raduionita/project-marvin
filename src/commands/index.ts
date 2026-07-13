import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

import { Context } from "../types";

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listCommands(ctx: Context): string[] {
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.') &&
    !f.includes('.d.') &&
    (ctx.isTest || !f.includes('.mock.')) &&
    f.endsWith('.ts')
  );
}
