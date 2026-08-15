import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

import type Engine from '../engine.js';
import { Channel } from '../types.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

let channels: string[] = [];

export function listChannels(engine: Engine): string[] {
  if (channels.length) return channels;
  return channels = readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  ).map(f => f.replace('.ts$', ''));
}


export async function loadChannel(engine: Engine, channelId: string) : Promise<Channel|null> {
  const Module = await import(`./${channelId}.js`);
  const Class = Module.default;
  if (!Class || !(Class.prototype instanceof Channel)) {
    return null;
  }
  return new Class(engine, engine.logger);
}
