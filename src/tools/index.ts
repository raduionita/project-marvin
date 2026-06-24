import { Context } from '../context.js';
import { Tool } from '../types.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

export function listTools(): string[] {
  return readdirSync(tdir).filter(f => !['index.ts'].includes(f) && !f.includes('.test') && f.endsWith('.ts'));
}

export async function execTool(ctx: Context, tool: string, args: any) {
  console.log('[marvin]', 'execTool', tool);

  const instance = ctx.tools[tool];
  if (!instance) {
    throw new Error(`execTool: Tool ${tool} not found`);
  }
  return await instance.call(ctx, args);
}
