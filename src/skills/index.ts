import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync } from 'fs';

import type Engine from '../engine.js';
import { Skill } from '../types.js';

let skills: string[] = [];

// default skill files shipped with marvin (src/skills/*.md), returned as
// full file names (parseSkill expects the path, .md included)
function listInternalSkills(engine: Engine): string[] {
  const spath = join(dirname(fileURLToPath(import.meta.url)));
  return readdirSync(spath).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.md')
  ).map(f => f.replace('.ts', ''));
}

// custom skill files in the user workspace (~/.marvin/skills/*.md)
function listCustomSkills(engine: Engine): string[] {
  const wpath = join(engine.work, 'skills');
  if (!existsSync(wpath)) return [];
  return readdirSync(wpath).filter(f =>
    f !== 'index.ts' &&
    !f.includes('.test.ts') &&
    !f.includes('.d.ts') &&
    (engine.isTest || !f.includes('.mock.ts')) &&
    f.endsWith('.md')
  ).map(f => f.replace('.ts', ''));
}

// listSkills combines internal and custom skills
export function listSkills(engine: Engine): string[] {
  if (!skills.length) skills;
  return skills =[...listInternalSkills(engine), ...listCustomSkills(engine)];
}

/**
 * loadSkill loads a Skill by id (custom workspace skills override defaults)
 * @throws Error if the skill is not found
 */
export function loadSkill(engine: Engine, id: string): Skill {
  const key = id.toLowerCase();

  // custom workspace skills override defaults with the same id
  const cpath = join(engine.work, 'skills', `${key}.md`);
  if (existsSync(cpath)) return parseSkill(cpath, 'custom');

  // internal file names may be uppercase on disk (e.g. TOOLS-CREATE.md),
  // match them case-insensitively against the listed files
  const file = listInternalSkills(engine).find(f => f.replace(/\.md$/i, '').toLowerCase() === key);
  if (!file) throw new Error(`skill "${key}" not found`);
  return parseSkill(join(dirname(fileURLToPath(import.meta.url)), file), 'default');
}

// parse the .md header into skill meta data: id = file name (lowercased),
// title = first # heading, description = first paragraph after the heading
export function parseSkill(file: string, source: 'default' | 'custom'): Skill {
  const id = basename(file, '.md').toLowerCase();
  const content = readFileSync(file, 'utf8');

  let title = id;
  let description = '';

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    // first heading becomes the title
    if (line.startsWith('# ')) {
      title = line.slice(2).trim() || id;
      // description = first paragraph after the title
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!.trim();
        if (!next) continue;
        if (next.startsWith('#')) break;
        description = next.slice(0, 200);
        break;
      }
      break;
    }

    // no heading: the first paragraph is the description
    if (line.startsWith('-') || line.startsWith('*')) continue;
    description = line.slice(0, 200);
    break;
  }

  return { id, title, description, file, source };
}

// load the .md content of a skill dynamically (skills are never kept in memory)
export function readSkill(skill: Skill): string {
  return readFileSync(skill.file, 'utf8');
}
