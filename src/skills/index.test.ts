import { test, expect } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { listSkills, loadSkill, parseSkill, readSkill } from './index.js';

function buildEngine(customSkills?: Record<string, string>): Engine {
  const engine = new Engine(new Logger());
  engine.work = join(tmpdir(), 'marvin-skills-test-' + Date.now() + Math.random().toString(36).slice(2, 8));
  if (customSkills) {
    mkdirSync(join(engine.work, 'skills'), { recursive: true });
    for (const [name, content] of Object.entries(customSkills)) {
      writeFileSync(join(engine.work, 'skills', `${name}.md`), content);
    }
  }
  return engine;
}

test('listSkills combines internal and custom skills', () => {
  const engine = buildEngine({ 'my-skill': '# My Skill\n\nDoes something.' });
  const skills = listSkills(engine);
  expect(skills).toContain('SKILLS-CREATE.md');
  expect(skills).toContain('my-skill.md');
});

test('loadSkill loads an internal skill by lowercase id', () => {
  const engine = buildEngine();
  const skill = loadSkill(engine, 'tools-create');
  expect(skill.id).toBe('tools-create');
  expect(skill.source).toBe('default');
  expect(skill.title.toLowerCase()).toContain('tool');
});

test('loadSkill prefers the custom skill over the default', () => {
  const engine = buildEngine({ 'tools-create': '# Custom Tools Create\n\nOverrides the default.' });
  const skill = loadSkill(engine, 'tools-create');
  expect(skill.id).toBe('tools-create');
  expect(skill.source).toBe('custom');
  expect(skill.title).toBe('Custom Tools Create');
});

test('loadSkill loads a custom-only skill', () => {
  const engine = buildEngine({ 'my-skill': '# My Skill\n\nDoes something.' });
  const skill = loadSkill(engine, 'my-skill');
  expect(skill.id).toBe('my-skill');
  expect(skill.source).toBe('custom');
});

test('loadSkill throws for an unknown skill', () => {
  const engine = buildEngine();
  expect(() => loadSkill(engine, 'nope')).toThrow('not found');
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
