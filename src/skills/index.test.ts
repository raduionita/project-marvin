import { test, expect } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import Engine from '../engine.js';
import { listSkills, listCustomSkills, parseSkill, readSkill } from './index.js';

function buildEngine(customSkills?: Record<string, string>): Engine {
  const engine = new Engine();
  engine.work = join(tmpdir(), 'marvin-skills-test-' + Date.now() + Math.random().toString(36).slice(2, 8));
  if (customSkills) {
    mkdirSync(join(engine.work, 'skills'), { recursive: true });
    for (const [name, content] of Object.entries(customSkills)) {
      writeFileSync(join(engine.work, 'skills', `${name}.md`), content);
    }
  }
  return engine;
}

test('listSkills returns the default .md skill files', () => {
  const engine = buildEngine();
  const skills = listSkills(engine);
  expect(skills).toContain('META.md');
  expect(skills).toContain('TOOLS-CREATE.md');
  expect(skills).toContain('TOOLS-EDIT.md');
  expect(skills).not.toContain('index.ts');
});

test('listCustomSkills returns workspace skills only when present', () => {
  const engine = buildEngine({ 'my-skill': '# My Skill\n\nDoes something.' });
  const skills = listCustomSkills(engine);
  expect(skills).toEqual(['my-skill.md']);

  const empty = buildEngine();
  expect(listCustomSkills(empty)).toEqual([]);
});

test('parseSkill extracts id, title, description and source', () => {
  const file = join(tmpdir(), `parse-skill-${Date.now()}.md`);
  writeFileSync(file, '# Release Notes\n\nTurn changes into release notes.\nMore text here.');

  const skill = parseSkill(file, 'custom');

  expect(skill.id).toBe(basename(file, '.md'));
  expect(skill.title).toBe('Release Notes');
  expect(skill.description).toBe('Turn changes into release notes.');
  expect(skill.source).toBe('custom');
  expect(skill.file).toBe(file);
});

test('parseSkill falls back to the file name when there is no heading', () => {
  const file = join(tmpdir(), `plain-${Date.now()}.md`);
  writeFileSync(file, 'Just some text without a heading.');

  const skill = parseSkill(file, 'default');

  expect(skill.id).toBe(basename(file, '.md'));
  expect(skill.title).toBe(basename(file, '.md'));
  expect(skill.description).toBe('Just some text without a heading.');
});

test('readSkill loads the .md content dynamically', () => {
  const engine = buildEngine({ 'my-skill': '# My Skill\n\nInstruction body.' });
  const file = join(engine.work, 'skills', 'my-skill.md');
  const skill = parseSkill(file, 'custom');

  const content = readSkill(skill);
  expect(content).toContain('# My Skill');
  expect(content).toContain('Instruction body.');
});