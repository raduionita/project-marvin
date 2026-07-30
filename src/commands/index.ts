import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

import type Engine from '../engine';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listCommands(engine: Engine): string[] {
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.') &&
    !f.includes('.d.') &&
    (engine.isTest || !f.includes('.mock.')) &&
    f.endsWith('.ts')
  );
}
