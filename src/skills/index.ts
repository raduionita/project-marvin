import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync } from 'fs';

import type Engine from '../engine.js';
import { Skill } from '../types.js';

const tdir = join(dirname(fileURLToPath(import.meta.url)));

let skills: string[] = [];

// default skill files shipped with marvin (src/skills/*.md)
export function listSkills(engine: Engine): string[] {
  if (skills.length) return skills;
  return skills = readdirSync(tdir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
}

// custom skill files in the user workspace (~/.marvin/skills/*.md)
export function listCustomSkills(engine: Engine): string[] {
  const cdir = join(engine.work, 'skills');
  if (!existsSync(cdir)) return [];
  return readdirSync(cdir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
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
