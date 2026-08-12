import { test, expect } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Engine from '../engine.js';
import ToolsCommand from './tools.js';
import { Skill, Config } from '../types.js';

function mockEngine(isDry = false): Engine {
  const engine = new Engine();
  engine.isDry = isDry;
  engine.work = join(tmpdir(), 'marvin-tools-cmd-' + Date.now() + Math.random().toString(36).slice(2, 8));
  mkdirSync(join(engine.work, 'skills'), { recursive: true });
  mkdirSync(join(engine.work, 'tools'), { recursive: true });
  engine.config = {
    settings: { name: 'marvin', host: '127.0.0.1', port: 7331, logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: {},
    models: { 'deepseek/deepseek-chat': { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    agents: {},
  } as Config;

  // the skills used by `tools add` / `tools edit`
  const createSkill: Skill = {
    id: 'tools-create',
    title: 'Create a Tool',
    description: 'Creates tools',
    file: join(engine.work, 'skills', '__tools_create__.md'),
    source: 'default',
  };
  writeFileSync(createSkill.file, '# Create a Tool\n\nReturn ONLY the tool file content.');
  engine.skills['tools-create'] = createSkill;

  const editSkill: Skill = {
    id: 'tools-edit',
    title: 'Edit a Tool',
    description: 'Edits tools',
    file: join(engine.work, 'skills', '__tools_edit__.md'),
    source: 'default',
  };
  writeFileSync(editSkill.file, '# Edit a Tool\n\nReturn ONLY the complete updated tool file content.');
  engine.skills['tools-edit'] = editSkill;

  // stub out heavy engine loading for the command test
  engine.load = async () => { engine.state = 'load'; };
  engine.loadTools = async () => {};
  return engine;
}

function scriptedAsk(answers: string[]) {
  const queue = [...answers];
  return async () => queue.shift() || '';
}

test('tools add writes a custom tool to ~/.marvin/tools', async () => {
  const engine = mockEngine();
  const cmd = new ToolsCommand(engine, ['add', 'my_tool', 'does something']);
  cmd.ask = scriptedAsk([]);

  // stub the LLM call to return generated tool source
  engine.execChat = async () => ({ content: `import { Tool } from '${engine.root}/src/types.js';\nexport default class MyTool extends Tool { /* ... */ }`, steps: 1 });

  await cmd.execAdd();

  const tpath = join(engine.work, 'tools', 'my_tool.ts');
  expect(existsSync(tpath)).toBe(true);
  expect(readFileSync(tpath, 'utf8')).toContain('MyTool');
});

test('tools add prompts for tool name and description when missing', async () => {
  const engine = mockEngine();
  const cmd = new ToolsCommand(engine, []);
  cmd.ask = scriptedAsk(['prompted_tool', 'prompted purpose']);
  engine.execChat = async () => ({ content: 'export default class PromptedTool extends Tool {}', steps: 1 });

  await cmd.execAdd();

  expect(existsSync(join(engine.work, 'tools', 'prompted_tool.ts'))).toBe(true);
});

test('tools add refuses an existing tool', async () => {
  const engine = mockEngine();
  writeFileSync(join(engine.work, 'tools', 'existing.ts'), '# Existing\n\nAlready here.');
  const cmd = new ToolsCommand(engine, ['add', 'existing', 'desc']);
  cmd.ask = scriptedAsk([]);

  const warnLogs: string[] = [];
  const orig = console.warn;
  console.warn = (...args: any[]) => warnLogs.push(args.join(' '));
  try {
    await cmd.execAdd();
  } finally {
    console.warn = orig;
  }

  expect(warnLogs.join('\n')).toContain('already exists');
});

test('tools add works in dry mode without calling the LLM', async () => {
  const engine = mockEngine(true);
  const cmd = new ToolsCommand(engine, ['add', 'dry_tool', 'desc']);
  cmd.ask = scriptedAsk([]);
  let called = false;
  engine.execChat = async () => { called = true; return null; };

  await cmd.execAdd();

  expect(called).toBe(false);
  expect(existsSync(join(engine.work, 'tools', 'dry_tool.ts'))).toBe(false);
});

test('tools add replaces the MARVIN_ROOT placeholder in generated code', async () => {
  const engine = mockEngine();
  const cmd = new ToolsCommand(engine, ['add', 'rooted_tool', 'desc']);
  cmd.ask = scriptedAsk([]);
  engine.execChat = async () => ({ content: "import { Tool } from '{MARVIN_ROOT}/src/types.js';\nexport default class RootedTool extends Tool {}", steps: 1 });

  await cmd.execAdd();

  const content = readFileSync(join(engine.work, 'tools', 'rooted_tool.ts'), 'utf8');
  expect(content).toContain(engine.root + '/src/types.js');
  expect(content).not.toContain('{MARVIN_ROOT}');
});

test('tools edit rewrites an existing custom tool', async () => {
  const engine = mockEngine();
  const tpath = join(engine.work, 'tools', 'my_tool.ts');
  writeFileSync(tpath, "import { Tool } from 'x';\nexport default class MyTool extends Tool { pong = false }");

  const cmd = new ToolsCommand(engine, ['edit', 'my_tool', 'add a ping parameter']);
  cmd.ask = scriptedAsk([]);
  engine.execChat = async () => ({ content: "import { Tool } from 'x';\nexport default class MyTool extends Tool { pong = true }", steps: 1 });

  await cmd.execEdit();

  expect(readFileSync(tpath, 'utf8')).toContain('pong = true');
});

test('tools edit sends the current tool code to the LLM', async () => {
  const engine = mockEngine();
  const tpath = join(engine.work, 'tools', 'my_tool.ts');
  writeFileSync(tpath, 'export default class MyTool extends Tool { original = true }');

  const cmd = new ToolsCommand(engine, ['edit', 'my_tool', 'make it better']);
  cmd.ask = scriptedAsk([]);
  let prompt = '';
  engine.execChat = async (_a: any, _b: any, p: string) => { prompt = p; return { content: 'updated', steps: 1 }; };

  await cmd.execEdit();

  expect(prompt).toContain('MyTool');
  expect(prompt).toContain('make it better');
});

test('tools edit errors when the tool does not exist', async () => {
  const engine = mockEngine();
  const cmd = new ToolsCommand(engine, ['edit', 'nope', 'change']);
  cmd.ask = scriptedAsk([]);

  const errLogs: string[] = [];
  const orig = console.error;
  console.error = (...args: any[]) => errLogs.push(args.join(' '));
  try {
    await cmd.execEdit();
  } finally {
    console.error = orig;
  }

  expect(errLogs.join('\n')).toContain('not found');
});

test('tools edit works in dry mode without calling the LLM', async () => {
  const engine = mockEngine(true);
  const tpath = join(engine.work, 'tools', 'dry_tool.ts');
  writeFileSync(tpath, 'old code');
  const cmd = new ToolsCommand(engine, ['edit', 'dry_tool', 'update']);
  cmd.ask = scriptedAsk([]);
  let called = false;
  engine.execChat = async () => { called = true; return null; };

  await cmd.execEdit();

  expect(called).toBe(false);
  expect(readFileSync(tpath, 'utf8')).toBe('old code');
});