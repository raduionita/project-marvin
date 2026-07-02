import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

import { App } from '../types.js';
import { Context } from '../context.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listTools(context: Context): string[] {
  return readdirSync(tdir).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (context.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  );
}

// TODO: consider moving this server.ts?!
export async function execTool(ctx: Context, tool: string, args: any) {
  console.log('[marvin]', 'execTool', tool);

  const instance = ctx.tools[tool];
  if (!instance) {
    throw new Error(`execTool: Tool ${tool} not found`);
  }
  return await instance.call(args);
}
