import { test, expect } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import SkillsCommand from './skills.js';
import { Skill, Config } from '../types.js';

function mockEngine(isDry = false): Engine {
  const engine = new Engine(new Logger());
  engine.isDry = isDry;
  engine.work = join(tmpdir(), 'marvin-skills-cmd-' + Date.now() + Math.random().toString(36).slice(2, 8));
  mkdirSync(join(engine.work, 'skills'), { recursive: true });
  engine.config = {
    settings: { name: 'marvin', host: '127.0.0.1', port: 7331, logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: {},
    models: { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    agents: {},
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

  // stub out heavy engine loading for the command test
  engine.load = async () => { engine.state = 'load'; };
  return engine;
}

function scriptedAsk(answers: string[]) {
  const queue = [...answers];
  return async () => queue.shift() || '';
}

// a logger that captures every emitted line (info-level and up), so tests can
// assert on command output without patching console.*
function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = new Logger({ level: 'info', output: (_level, args) => lines.push(args.map(String).join(' ')) });
  return { logger, lines };
}

test('skills add writes a custom skill file to ~/.marvin/skills', async () => {
  const engine = mockEngine();
  const cmd = new SkillsCommand(engine, new Logger(), ['add', 'release-notes', 'write release notes']);
  cmd.ask = scriptedAsk([]);

  // stub the LLM call to return generated skill content
  engine.execChat = async () => ({ content: '# Release Notes\n\nTurn a changelog into release notes.', steps: 1 });

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
  const cmd = new SkillsCommand(engine, new Logger(), []);
  cmd.ask = scriptedAsk(['my-skill', 'does something useful']);
  engine.execChat = async () => ({ content: '# My Skill\n\nDoes something useful.', steps: 1 });

  await cmd.execAdd();

  const spath = join(engine.work, 'skills', 'my-skill.md');
  expect(existsSync(spath)).toBe(true);
  expect(engine.skills['my-skill']).toBeDefined();
});

test('skills add refuses an existing skill', async () => {
  const engine = mockEngine();
  writeFileSync(join(engine.work, 'skills', 'existing.md'), '# Existing\n\nAlready here.');
  const { logger, lines } = captureLogger();
  const cmd = new SkillsCommand(engine, logger, ['add', 'existing', 'desc']);
  cmd.ask = scriptedAsk([]);

  await cmd.execAdd();

  expect(lines.join('\n')).toContain('already exists');
});

test('skills add works in dry mode without calling the LLM', async () => {
  const engine = mockEngine(true);
  const cmd = new SkillsCommand(engine, new Logger(), ['add', 'dry-skill', 'desc']);
  cmd.ask = scriptedAsk([]);
  let called = false;
  engine.execChat = async () => { called = true; return null; };

  await cmd.execAdd();

  expect(called).toBe(false);
  expect(existsSync(join(engine.work, 'skills', 'dry-skill.md'))).toBe(false);
});

test('skills list prints default and custom skills', async () => {
  const engine = mockEngine();
  // load the default skills (meta/tools) into the engine, plus one custom
  await engine.loadSkills();
  writeFileSync(join(engine.work, 'skills', 'my-skill.md'), '# My Skill\n\nDoes something.');
  await engine.loadSkills();

  const { logger, lines } = captureLogger();
  const cmd = new SkillsCommand(engine, logger, ['list']);

  await cmd.exec();

  const out = lines.join('\n');
  expect(out).toContain('default skills');
  expect(out).toContain('meta');
  expect(out).toContain('tools-create');
  expect(out).toContain('tools-edit');
  expect(out).toContain('my-skill');
});

// register the "tools-create" skill (the one used by `skills use`) like the meta skill
function addToolsSkill(engine: Engine): Skill {
  const toolsSkill: Skill = {
    id: 'tools-create',
    title: 'Create a Tool',
    description: 'Creates tools',
    file: join(engine.work, 'skills', '__tools__.md'),
    source: 'default',
  };
  writeFileSync(toolsSkill.file, '# Create a Tool\n\nYou are creating a new Marvin tool.');
  engine.skills['tools-create'] = toolsSkill;
  return toolsSkill;
}

test('skills use runs the tools-create skill and saves the generated tool', async () => {
  const engine = mockEngine();
  addToolsSkill(engine);
  const { logger, lines } = captureLogger();
  const cmd = new SkillsCommand(engine, logger, ['use', 'tools-create', 'web_fetch']);
  cmd.ask = scriptedAsk(['fetch a URL and return the text']);

  // stub the LLM call to return generated tool source
  engine.execChat = async () => ({ content: `import { Tool } from '{MARVIN_ROOT}/src/types.js';\nexport default class WebFetch extends Tool { /* ... */ }`, steps: 1 });

  await cmd.execUse();

  const tpath = join(engine.work, 'tools', 'web_fetch.ts');
  expect(existsSync(tpath)).toBe(true);
  expect(readFileSync(tpath, 'utf8')).toContain('WebFetch');
  // the MARVIN_ROOT placeholder is resolved before writing
  expect(readFileSync(tpath, 'utf8')).toContain(engine.root);
  expect(readFileSync(tpath, 'utf8')).not.toContain('{MARVIN_ROOT}');
  expect(engine.skills['tools-create']).toBeDefined();
  expect(lines.join('\n')).toContain('tool "web_fetch" created');
  expect(lines.join('\n')).toContain('used skill "tools-create"');
});

test('skills use prompts for the skill and info when missing', async () => {
  const engine = mockEngine();
  addToolsSkill(engine);
  const cmd = new SkillsCommand(engine, new Logger(), ['use']);
  // answers: skill pick, tool name, tool purpose
  cmd.ask = scriptedAsk(['tools-create', 'my_tool', 'does something']);

  engine.execChat = async () => ({ content: 'export default class MyTool extends Tool { /* ... */ }', steps: 1 });

  await cmd.execUse();

  const tpath = join(engine.work, 'tools', 'my_tool.ts');
  expect(existsSync(tpath)).toBe(true);
  expect(engine.skills['my_tool']).toBeUndefined();
});

test('skills use errors on unknown skill', async () => {
  const engine = mockEngine();
  const { logger, lines } = captureLogger();
  const cmd = new SkillsCommand(engine, logger, ['use', 'nope']);
  cmd.ask = scriptedAsk([]);

  await cmd.execUse();

  expect(lines.join('\n')).toContain('unknown skill');
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

  const cmd = new SkillsCommand(engine, new Logger(), ['use', 'tools-edit', 'my_tool']);
  cmd.ask = scriptedAsk(['make it return more data']);

  engine.execChat = async () => ({ content: 'new code', steps: 1 });

  await cmd.execUse();

  expect(readFileSync(tpath, 'utf8')).toContain('new code');
  expect(engine.skills['tools-edit']).toBeDefined();
});

test('skills use works in dry mode without calling the LLM or writing the tool', async () => {
  const engine = mockEngine(true);
  addToolsSkill(engine);
  const cmd = new SkillsCommand(engine, new Logger(), ['use', 'tools-create', 'dry_tool']);
  cmd.ask = scriptedAsk(['does something']);
  let called = false;
  engine.execChat = async () => { called = true; return null; };

  await cmd.execUse();

  expect(called).toBe(false);
  expect(existsSync(join(engine.work, 'tools', 'dry_tool.ts'))).toBe(false);
});