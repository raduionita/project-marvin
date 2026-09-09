import { mock, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Config } from '../types.js';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { buildPromptMocks, captureLogger } from '../helpers/tests.js';

// scripted answers consumed by the mocked @inquirer/prompts prompts
let answers: string[] = [];
const promptMocks = buildPromptMocks(() => answers);
mock.module('@inquirer/prompts', () => promptMocks);

// injectable snippet for the editor() prompt (no $EDITOR in tests)
let injectedSnippet = '';
mock.module('../terminal.js', () => ({ ...promptMocks, editor: async () => injectedSnippet }));

import McpsCommand from './mcps.js';

// path of the mock stdio mcp server used as a real connectable endpoint
const MOCK_SERVER = join(import.meta.dirname, '../mcp.mock.ts');

function buildEngine(...mcps: [string, { [key: string]: any }][]): Engine {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  const config = {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    mcps: Object.fromEntries(mcps) as Config['mcps'],
    models: {},
    agents: {},
    tasks: {},
  } as Config;
  writeFileSync(join(engine.work, 'marvin.json'), JSON.stringify(config, null, 2));
  engine.config = config;
  return engine;
}

function readConfig(engine: Engine): { [key: string]: any } {
  return JSON.parse(readFileSync(join(engine.work, 'marvin.json'), 'utf8'));
}

// write an mcp snippet pointing at the mock stdio server
const MOCK_SPEC = () => ({
  command: process.execPath,
  args: [MOCK_SERVER],
  env: { MOCK_MCP_TOKEN: 'secret-token' },
});

test('execList lists configured mcps', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: ['-y', '@x/y'], env: { WP_API_URL: 'https://gloobeam.com' } }]);
  const { lines, restore } = captureLogger();
  const cmd = new McpsCommand(engine, ['list']);

  await cmd.exec();

  const out = lines.join('\n');
  expect(out).toContain('gloobeam');
  expect(out).toContain('npx -y @x/y');
  expect(out).toContain('WP_API_URL');
  restore();
});

test('execDrop removes an mcp and persists (no task unlinking, per-agent tools)', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  engine.config.tasks = { post: { enabled: true, schedule: 60 } } as Config['tasks'];
  const cmd = new McpsCommand(engine, ['drop', 'gloobeam']);

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.mcps['gloobeam']).toBeUndefined();
  expect((config.tasks.post as any).mcps).toBeUndefined();
});

test('execDrop warns for no mcps configured', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  const cmd = new McpsCommand(engine, ['drop', 'nope']);

  await cmd.exec();

  expect(lines.join('\n')).toContain('no mcps configured');
  expect(readConfig(engine).mcps).toEqual({});
  restore();
});

test('execAdd validates, connects and persists an mcp from a pasted snippet', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['add']);

  // scripted answers: name (no agents configured -> no attach prompt)
  answers = ['gloobeam'];

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.mcps['gloobeam']).toBeDefined();
  expect(config.mcps['gloobeam'].command).toBe(process.execPath);
  expect(config.mcps['gloobeam'].env.MOCK_MCP_TOKEN).toBe('secret-token');
  expect(lines.join('\n')).toContain('mcp added');
  restore();
});

test('execAdd no longer links the mcp to tasks (tools load per agent groups)', async () => {
  const engine = buildEngine();
  engine.config.tasks = {
    post: { enabled: true, schedule: 3600 },
    digest: { enabled: true, schedule: 60 },
  } as Config['tasks'];
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['add']);

  // scripted answers: name only (no task linking prompt)
  answers = ['gloobeam'];

  await cmd.exec();

  expect((engine.config.tasks!['post'] as any).mcps).toBeUndefined();
  expect((engine.config.tasks!['digest'] as any).mcps).toBeUndefined();
});

test('execAdd attaches the mcp as a tool group to the selected agents', async () => {
  const engine = buildEngine();
  engine.config.agents = {
    a1: { enabled: true, model: 'm', channels: {}, tools: ['web'] },
    a2: { enabled: true, model: 'm', channels: {}, tools: [] },
  } as Config['agents'];
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['add']);

  // scripted answers: name + agents to attach to (1-based checkbox indices)
  answers = ['gloobeam', '1,2'];

  await cmd.exec();

  expect(readConfig(engine).mcps['gloobeam']).toBeDefined();
  expect(engine.config.agents['a1']!.tools).toEqual(['web', 'gloobeam']);
  expect(engine.config.agents['a2']!.tools).toEqual(['gloobeam']);
});

test('pickAgents excludes the orchestrator (always has all tools)', async () => {
  const engine = buildEngine();
  engine.config.agents = {
    marvin: { enabled: true, model: 'm', channels: {}, tools: [] },
    a1: { enabled: true, model: 'm', channels: {}, tools: [] },
  } as Config['agents'];
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['add']);

  // scripted answers: name + blank (selects all offered agents)
  answers = ['gloobeam', ''];

  await cmd.exec();

  expect(engine.config.agents['a1']!.tools).toEqual(['gloobeam']);
  // orchestrator untouched (never offered, always loads everything)
  expect(engine.config.agents['marvin']!.tools).toEqual([]);
});

test('execDrop detaches the mcp tool group from all agents', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  engine.config.agents = {
    a1: { enabled: true, model: 'm', channels: {}, tools: ['web', 'gloobeam'] },
    a2: { enabled: true, model: 'm', channels: {}, tools: [] },
  } as Config['agents'];
  const cmd = new McpsCommand(engine, ['drop', 'gloobeam']);

  await cmd.exec();

  expect(readConfig(engine).mcps['gloobeam']).toBeUndefined();
  expect(engine.config.agents['a1']!.tools).toEqual(['web']);
  expect(engine.config.agents['a2']!.tools).toEqual([]);
});

test('execAdd rejects invalid json snippets', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  injectedSnippet = '{not json';
  const cmd = new McpsCommand(engine, ['add']);

  // scripted answers: name
  answers = ['gloobeam'];

  await cmd.exec();

  expect(lines.join('\n')).toContain('invalid json');
  expect(readConfig(engine).mcps).toEqual({});
});

test('execAdd rejects snippets without a command', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  injectedSnippet = JSON.stringify({ args: ['-y', '@x/y'] });
  const cmd = new McpsCommand(engine, ['add']);

  // scripted answers: name
  answers = ['gloobeam'];

  await cmd.exec();

  expect(lines.join('\n')).toContain('invalid mcp snippet');
  expect(readConfig(engine).mcps).toEqual({});
  restore();
});

test('execAdd unwraps claude-style mcpServers snippets', async () => {
  const engine = buildEngine();
  injectedSnippet = JSON.stringify({ mcpServers: { gloobeam: MOCK_SPEC() } }, null, 2);
  const cmd = new McpsCommand(engine, ['add']);

  // scripted answers: name
  answers = ['gloobeam'];

  await cmd.exec();

  expect(readConfig(engine).mcps['gloobeam']).toBeDefined();
});

test('execAdd aborts on failed connection unless confirmed', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  // command that exits immediately -> initialize fails
  injectedSnippet = JSON.stringify({ command: 'false', args: [] });
  const cmd = new McpsCommand(engine, ['add']);

  // scripted answers: name -> confirm prompt ("n" = do not save anyway)
  answers = ['broken', 'n'];

  await cmd.exec();

  expect(lines.join('\n')).toContain('aborted');
  expect(readConfig(engine).mcps).toEqual({});
  restore();
});

test('execEdit replaces the spawn spec and persists', async () => {
  const engine = buildEngine(['gloobeam', { enabled: false, command: 'old-cmd', args: [] }]);
  // edit reads the snippet from the multiline prompt (file arg is ignored)
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['edit', 'gloobeam']);

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.mcps['gloobeam'].command).toBe(process.execPath);
  // previous enabled flag kept when the snippet does not set one
  expect(config.mcps['gloobeam'].enabled).toBe(false);
});

test('execEdit attaches the mcp to the selected agent', async () => {
  const engine = buildEngine(['gloobeam', { enabled: false, command: 'old-cmd', args: [] }]);
  engine.config.agents = {
    a1: { enabled: true, model: 'm', channels: {}, tools: ['web'] },
    a2: { enabled: true, model: 'm', channels: {}, tools: [] },
  } as Config['agents'];
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['edit', 'gloobeam']);

  // scripted answers: attach to a2 (1-based checkbox index)
  answers = ['2'];

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.mcps['gloobeam'].command).toBe(process.execPath);
  expect(engine.config.agents['a2']!.tools).toEqual(['gloobeam']);
  expect(engine.config.agents['a1']!.tools).toEqual(['web']);
});

test('execEdit attach keeps the already attached agent (idempotent)', async () => {
  const engine = buildEngine(['gloobeam', { enabled: false, command: 'old-cmd', args: [] }]);
  engine.config.agents = {
    a1: { enabled: true, model: 'm', channels: {}, tools: ['gloobeam'] },
    a2: { enabled: true, model: 'm', channels: {}, tools: [] },
  } as Config['agents'];
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['edit', 'gloobeam']);

  // blank answer -> all offered agents (mock), re-attaching a1 is idempotent
  answers = [''];

  await cmd.exec();

  expect(engine.config.agents['a1']!.tools).toEqual(['gloobeam']);
  expect(engine.config.agents['a2']!.tools).toEqual(['gloobeam']);
});

test('execAdd rejects invalid names', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['add', 'bad name!']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('invalid name');
  expect(readConfig(engine).mcps).toEqual({});
  restore();
});

test('execAdd refuses already configured mcps', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  const { lines, restore } = captureLogger();
  const cmd = new McpsCommand(engine, ['add', 'gloobeam']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('already configured');
  expect(readConfig(engine).mcps['gloobeam'].command).toBe('npx');
  restore();
});

test('execAdd saves anyway when confirmed after a failed connection', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  // command that exits immediately -> initialize fails
  injectedSnippet = JSON.stringify({ command: 'false', args: [] });
  const cmd = new McpsCommand(engine, ['add']);

  // scripted answers: name -> confirm prompt ("y" = save anyway)
  answers = ['broken', 'y'];

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.mcps['broken']).toBeDefined();
  expect(config.mcps['broken'].enabled).toBe(true);
  expect(lines.join('\n')).toContain('mcp added');
  restore();
});

test('execAdd attaches via the agent arg without prompting', async () => {
  const engine = buildEngine();
  engine.config.agents = {
    a1: { enabled: true, model: 'm', channels: {}, tools: ['web'] },
    a2: { enabled: true, model: 'm', channels: {}, tools: [] },
  } as Config['agents'];
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['add', 'gloobeam', 'a2']);

  // no prompts consumed (name + agent both from args)
  answers = [];

  await cmd.exec();

  expect(engine.config.agents['a2']!.tools).toEqual(['gloobeam']);
  expect(engine.config.agents['a1']!.tools).toEqual(['web']);
});

test('execAdd warns on unknown agent arg but still saves', async () => {
  const engine = buildEngine();
  engine.config.agents = {
    a1: { enabled: true, model: 'm', channels: {}, tools: [] },
  } as Config['agents'];
  const { lines, restore } = captureLogger();
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['add', 'gloobeam', 'nope']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('unknown agent');
  expect(readConfig(engine).mcps['gloobeam']).toBeDefined();
  expect(engine.config.agents['a1']!.tools).toEqual([]);
  restore();
});

test('execAdd skips attach for the orchestrator arg', async () => {
  const engine = buildEngine();
  engine.config.agents = {
    marvin: { enabled: true, model: 'm', channels: {}, tools: [] },
    a1: { enabled: true, model: 'm', channels: {}, tools: [] },
  } as Config['agents'];
  const { lines, restore } = captureLogger();
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['add', 'gloobeam', 'marvin']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('orchestrator');
  expect(readConfig(engine).mcps['gloobeam']).toBeDefined();
  expect(engine.config.agents['marvin']!.tools).toEqual([]);
  expect(engine.config.agents['a1']!.tools).toEqual([]);
  restore();
});

test('execAdd without agents still saves the mcp', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['add']);

  answers = ['gloobeam'];

  await cmd.exec();

  expect(readConfig(engine).mcps['gloobeam']).toBeDefined();
  expect(lines.join('\n')).toContain('mcp added');
  restore();
});

test('execEdit warns when no mcps are configured', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  const cmd = new McpsCommand(engine, ['edit']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('no mcps configured');
  restore();
});

test('execEdit errors for unknown mcps', async () => {
  const engine = buildEngine(['other', { enabled: true, command: 'npx', args: [] }]);
  const { lines, restore } = captureLogger();
  const cmd = new McpsCommand(engine, ['edit', 'nope']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('not found in config');
  expect(Object.keys(readConfig(engine).mcps)).toEqual(['other']);
  restore();
});

test('execEdit prompts to select the mcp', async () => {
  const engine = buildEngine(['gloobeam', { enabled: false, command: 'old-cmd', args: [] }]);
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['edit']);

  // scripted answers: mcp name (no agents -> no attach prompt)
  answers = ['gloobeam'];

  await cmd.exec();

  expect(readConfig(engine).mcps['gloobeam'].command).toBe(process.execPath);
});

test('execEdit rejects invalid json snippets', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  const { lines, restore } = captureLogger();
  injectedSnippet = '{not json';
  const cmd = new McpsCommand(engine, ['edit', 'gloobeam']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('invalid json');
  expect(readConfig(engine).mcps['gloobeam'].command).toBe('npx');
  restore();
});

test('execEdit rejects snippets without a command', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  const { lines, restore } = captureLogger();
  injectedSnippet = JSON.stringify({ args: ['-y', '@x/y'] });
  const cmd = new McpsCommand(engine, ['edit', 'gloobeam']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('invalid mcp snippet');
  expect(readConfig(engine).mcps['gloobeam'].command).toBe('npx');
  restore();
});

test('execEdit aborts on failed connection unless confirmed', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  const { lines, restore } = captureLogger();
  // command that exits immediately -> initialize fails
  injectedSnippet = JSON.stringify({ command: 'false', args: [] });
  const cmd = new McpsCommand(engine, ['edit', 'gloobeam']);

  // scripted answers: confirm prompt ("n" = do not save anyway)
  answers = ['n'];

  await cmd.exec();

  expect(lines.join('\n')).toContain('aborted');
  expect(readConfig(engine).mcps['gloobeam'].command).toBe('npx');
  restore();
});

test('execEdit saves anyway when confirmed after a failed connection', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  const { lines, restore } = captureLogger();
  injectedSnippet = JSON.stringify({ command: 'false', args: [] });
  const cmd = new McpsCommand(engine, ['edit', 'gloobeam']);

  // scripted answers: confirm prompt ("y" = save anyway, no agents -> no attach prompt)
  answers = ['y'];

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.mcps['gloobeam'].command).toBe('false');
  expect(lines.join('\n')).toContain('mcp updated');
  restore();
});

test('execEdit attaches via the agent arg without prompting', async () => {
  const engine = buildEngine(['gloobeam', { enabled: false, command: 'old-cmd', args: [] }]);
  engine.config.agents = {
    a1: { enabled: true, model: 'm', channels: {}, tools: [] },
    a2: { enabled: true, model: 'm', channels: {}, tools: [] },
  } as Config['agents'];
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['edit', 'gloobeam', 'a1']);

  // no prompts consumed (mcp + agent both from args)
  answers = [];

  await cmd.exec();

  expect(engine.config.agents['a1']!.tools).toEqual(['gloobeam']);
  expect(engine.config.agents['a2']!.tools).toEqual([]);
});

test('execEdit without agents still saves the mcp', async () => {
  const engine = buildEngine(['gloobeam', { enabled: false, command: 'old-cmd', args: [] }]);
  const { lines, restore } = captureLogger();
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, ['edit', 'gloobeam']);

  answers = [];

  await cmd.exec();

  expect(readConfig(engine).mcps['gloobeam'].command).toBe(process.execPath);
  expect(lines.join('\n')).toContain('mcp updated');
  restore();
});

test('execInfo warns when no mcps are configured', async () => {
  const engine = buildEngine();
  const { lines, restore } = captureLogger();
  const cmd = new McpsCommand(engine, ['info']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('no mcps configured');
  restore();
});

test('execInfo errors for unknown mcps', async () => {
  const engine = buildEngine(['other', { enabled: true, command: 'npx', args: [] }]);
  const { lines, restore } = captureLogger();
  const cmd = new McpsCommand(engine, ['info', 'nope']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('not found in config');
  restore();
});

test('execDrop warns for unknown mcps', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  const { lines, restore } = captureLogger();
  const cmd = new McpsCommand(engine, ['drop', 'nope']);

  answers = [];

  await cmd.exec();

  expect(lines.join('\n')).toContain('not found in config');
  expect(readConfig(engine).mcps['gloobeam']).toBeDefined();
  restore();
});

test('execDrop prompts to select the mcp', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  const cmd = new McpsCommand(engine, ['drop']);

  // scripted answers: mcp name
  answers = ['gloobeam'];

  await cmd.exec();

  expect(readConfig(engine).mcps['gloobeam']).toBeUndefined();
});

test('exec routes help and unknown commands', async () => {
  const { lines, restore } = captureLogger();

  await new McpsCommand(buildEngine(), []).exec();
  expect(lines.join('\n')).toContain('usage: marvin mcps');

  lines.length = 0;
  await new McpsCommand(buildEngine(), ['frobnicate']).exec();
  expect(lines.join('\n')).toContain('unknown command');
  restore();
});

test('execInfo connects and prints the server tools', async () => {
  const engine = buildEngine(['gloobeam', MOCK_SPEC()]);
  const { lines, restore } = captureLogger();
  const cmd = new McpsCommand(engine, ['info', 'gloobeam']);

  await cmd.exec();

  const out = lines.join('\n');
  expect(out).toContain('echo');
  expect(out).toContain('Echo the input text');
  expect(out).toContain('peek_env');
  restore();
});
