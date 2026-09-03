import { mock, test, expect } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { Skill, Config } from '../types.js';
import { Agent } from '../agent.js';
import { buildPromptMocks, captureLogger } from '../helpers/tests.js';

// scripted answers consumed by the mocked @inquirer/prompts prompts
let answers: string[] = [];
const promptMocks = buildPromptMocks(() => answers);
mock.module('@inquirer/prompts', () => promptMocks);

import SkillsCommand from './skills.js';

function mockEngine(): Engine {
  const engine = new Engine();
  engine.work = join(tmpdir(), 'marvin-skills-cmd-' + Date.now() + Math.random().toString(36).slice(2, 8));
  mkdirSync(join(engine.work, 'skills'), { recursive: true });
  engine.config = {
    settings: { name: 'marvin', host: '127.0.0.1', port: 7331, logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    models: { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    agents: {},
    tasks: {},
    mcps: {},
  } as Config;

  // a loaded "meta" skill (the one used by `skills add`)
  const metaSkill: Skill = {
    id: 'meta',
    title: 'Create a Skill',
    description: 'Creates skills',
    file: join(engine.work, 'skills', '__meta__.md'),
    source: 'default',
  };
  writeFileSync(metaSkill.file, '# Create a Skill\n\nReturn ONLY the skill content.');
  engine.skills['meta'] = metaSkill;

  // stub agent whose sendChat is scripted per-test
  const agent = new Agent(engine, { id: 'marvin', enabled: true, identity: '', channels: {}, model: {} as never });
  agent.sendChat = async () => ({ content: '', steps: 0 });
  engine.agents['marvin'] = agent;
  return engine;
}

test('skills add writes a custom skill file to ~/.marvin/skills', async () => {
  const engine = mockEngine();
  const cmd = new SkillsCommand(engine, ['add', 'release-notes', 'write release notes']);
  answers = [];

  // stub the LLM call to return generated skill content
  engine.agents['marvin']!.sendChat = async () => ({ content: '# Release Notes\n\nTurn a changelog into release notes.', steps: 1 });

  await cmd.execAdd();

  const spath = join(engine.work, 'skills', 'release-notes.md');
  expect(existsSync(spath)).toBe(true);
  expect(readFileSync(spath, 'utf8')).toContain('# Release Notes');
  // registered in the engine without a reload
  expect(engine.skills['release-notes']).toBeDefined();
  expect(engine.skills['release-notes']!.source).toBe('custom');
});

test('skills add prompts for name and description when missing', async () => {
  const engine = mockEngine();
  const cmd = new SkillsCommand(engine, []);
  answers = ['my-skill', 'does something useful'];
  engine.agents['marvin']!.sendChat = async () => ({ content: '# My Skill\n\nDoes something useful.', steps: 1 });

  await cmd.execAdd();

  const spath = join(engine.work, 'skills', 'my-skill.md');
  expect(existsSync(spath)).toBe(true);
  expect(engine.skills['my-skill']).toBeDefined();
});

test('skills add refuses an existing skill', async () => {
  const engine = mockEngine();
  writeFileSync(join(engine.work, 'skills', 'existing.md'), '# Existing\n\nAlready here.');
  const { lines, restore } = captureLogger();
  const cmd = new SkillsCommand(engine, ['add', 'existing', 'desc']);
  answers = [];

  await cmd.execAdd();

  expect(lines.join('\n')).toContain('already exists');
  restore();
});

test('skills list prints default and custom skills', async () => {
  const engine = mockEngine();
  // load the default skills (meta/tools) into the engine, plus one custom
  await engine.loadSkills();
  writeFileSync(join(engine.work, 'skills', 'my-skill.md'), '# My Skill\n\nDoes something.');
  await engine.loadSkills();

  const { lines, restore } = captureLogger();
  const cmd = new SkillsCommand(engine, ['list']);

  await cmd.exec();

  const out = lines.join('\n');
  expect(out).toContain('skills:');
  expect(out).toContain('TOOLS-CREATE (default)');
  expect(out).toContain('TOOLS-EDIT (default)');
  expect(out).toContain('my-skill (custom)');
  restore();
});

// register the "TOOLS-CREATE" skill (the one used by `skills use`) like the meta skill
function addToolsSkill(engine: Engine): Skill {
  const toolsSkill: Skill = {
    id: 'TOOLS-CREATE',
    title: 'Create a Tool',
    description: 'Creates tools',
    file: join(engine.work, 'skills', '__tools__.md'),
    source: 'default',
  };
  writeFileSync(toolsSkill.file, '# Create a Tool\n\nYou are creating a new Marvin tool.');
  engine.skills['TOOLS-CREATE'] = toolsSkill;
  return toolsSkill;
}

test('skills use runs the TOOLS-CREATE skill and saves the generated tool', async () => {
  const engine = mockEngine();
  addToolsSkill(engine);
  const { lines, restore } = captureLogger();
  const cmd = new SkillsCommand(engine, ['use', 'TOOLS-CREATE', 'web_fetch']);
  answers = ['fetch a URL and return the text'];

  // stub the LLM call to return generated tool source
  engine.agents['marvin']!.sendChat = async () => ({ content: `import { Tool } from '{MARVIN_ROOT}/src/types.js';\nexport default class WebFetch extends Tool { /* ... */ }`, steps: 1 });

  await cmd.execUse();

  const tpath = join(engine.work, 'tools', 'web_fetch.ts');
  expect(existsSync(tpath)).toBe(true);
  expect(readFileSync(tpath, 'utf8')).toContain('WebFetch');
  // the MARVIN_ROOT placeholder is resolved before writing
  expect(readFileSync(tpath, 'utf8')).toContain(engine.root);
  expect(readFileSync(tpath, 'utf8')).not.toContain('{MARVIN_ROOT}');
  expect(engine.skills['TOOLS-CREATE']).toBeDefined();
  expect(lines.join('\n')).toContain('tool "web_fetch" created');
  expect(lines.join('\n')).toContain('used skill "TOOLS-CREATE"');
  restore();
});

test('skills use prompts for the skill and info when missing', async () => {
  const engine = mockEngine();
  addToolsSkill(engine);
  const cmd = new SkillsCommand(engine, ['use']);
  // answers: skill pick, tool name, tool purpose
  answers = ['TOOLS-CREATE', 'my_tool', 'does something'];

  engine.agents['marvin']!.sendChat = async () => ({ content: 'export default class MyTool extends Tool { /* ... */ }', steps: 1 });

  await cmd.execUse();

  const tpath = join(engine.work, 'tools', 'my_tool.ts');
  expect(existsSync(tpath)).toBe(true);
  expect(engine.skills['my_tool']).toBeUndefined();
});

test('skills use errors on unknown skill', async () => {
  const engine = mockEngine();
  const { lines, restore } = captureLogger();
  const cmd = new SkillsCommand(engine, ['use', 'nope']);
  answers = [];

  await cmd.execUse();

  expect(lines.join('\n')).toContain('unknown skill');
  restore();
});

test('skills use edits an existing tool with the tools-edit skill', async () => {
  const engine = mockEngine();
  const editSkill: Skill = {
    id: 'tools-edit',
    title: 'Edit a Tool',
    description: 'Edits tools',
    file: join(engine.work, 'skills', '__tools_edit__.md'),
    source: 'default',
  };
  writeFileSync(editSkill.file, '# Edit a Tool\n\nYou are editing an existing Marvin tool.');
  engine.skills['tools-edit'] = editSkill;

  const tpath = join(engine.work, 'tools', 'my_tool.ts');
  mkdirSync(join(engine.work, 'tools'), { recursive: true });
  writeFileSync(tpath, 'old code');

  const cmd = new SkillsCommand(engine, ['use', 'tools-edit', 'my_tool']);
  answers = ['make it return more data'];

  engine.agents['marvin']!.sendChat = async () => ({ content: 'new code', steps: 1 });

  await cmd.execUse();

  expect(readFileSync(tpath, 'utf8')).toContain('new code');
  expect(engine.skills['tools-edit']).toBeDefined();
});
