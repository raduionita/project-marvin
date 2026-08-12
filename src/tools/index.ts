import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';

import type Engine from '../engine.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listTools(engine: Engine): string[] {
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  );
}

// custom tool files in the user workspace (~/.marvin/tools/*.ts)
export function listCustomTools(engine: Engine): string[] {
  const cdir = join(engine.work, 'tools');
  if (!existsSync(cdir)) return [];
  return readdirSync(cdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    f.endsWith('.ts')
  );
}
