import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listChannels(): string[] {
  return readdirSync(tdir).filter(f => f !== 'index.ts' && !f.includes('.test') && f.endsWith('.ts'));
}
