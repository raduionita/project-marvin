import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';

import type Engine from '../engine.js';
import { Tool } from '../types.js';



let tools: string[] = [];

export function listInternalTools(engine: Engine): string[] {
  const tpath = join(dirname(fileURLToPath(import.meta.url)));
  return tools = readdirSync(tpath).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.ts')
  ).map(f => f.replace('.ts', ''));
}

// custom tool files in the user workspace (~/.marvin/tools/*.ts)
export function listCustomTools(engine: Engine): string[] {
  const wpath = join(engine.work, 'tools');
  if (!existsSync(wpath)) return [];
  return readdirSync(wpath).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    f.endsWith('.ts')
  ).map(f => f.replace('.ts', ''));
}

// listTools combines internal and custom tools
export function listTools(engine: Engine): string[] {
  if (tools.length) return tools;
  return [...listInternalTools(engine), ...listCustomTools(engine)];
}

/** 
 * loadTool loads a Tool instance by name (repo tools first, then custom workspace tools)
 * @throws Error if the tool is not found or does not export a Tool class
 */
export async function loadTool(engine: Engine, name: string): Promise<Tool> {
  const ipath = join(dirname(fileURLToPath(import.meta.url)), `${name}.ts`);
  const cpath = join(engine.work, 'tools', `${name}.ts`);
  let Module: any;
  if (existsSync(ipath)) {
    Module = await import(`../tools/${name}.js`);
  } else if (existsSync(cpath)) {
    Module = await import(cpath);
  } else {
    throw new Error(`tool "${name}" not found`);
  }
  const Class = Module.default;
  if (!Class || !(Class.prototype instanceof Tool)) {
    throw new Error(`${name} does not export a Tool class`);
  }
  return new Class(engine, engine.logger);
}
