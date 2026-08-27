import { mock, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Config } from '../types.js';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { buildPromptMocks, captureLogger } from '../tests.js';

// scripted answers consumed by the mocked @inquirer/prompts prompts
let answers: string[] = [];
const promptMocks = buildPromptMocks(() => answers);
mock.module('@inquirer/prompts', () => promptMocks);

// injectable snippet for the multiline() prompt (stdin is not readable in tests)
let injectedSnippet = '';
mock.module('../termina.js', () => ({ multiline: async () => injectedSnippet }));

import McpsCommand from './mcps.js';

// path of the mock stdio mcp server used as a real connectable endpoint
const MOCK_SERVER = join(import.meta.dirname, '../mcp.mock.ts');

function buildEngine(...mcps: [string, { [key: string]: any }][]): Engine {
  const engine = new Engine(new Logger());
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  const config = {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: {},
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
  const { logger, lines } = captureLogger();
  const cmd = new McpsCommand(engine, logger, ['list']);

  await cmd.exec();

  const out = lines.join('\n');
  expect(out).toContain('gloobeam');
  expect(out).toContain('npx -y @x/y');
  expect(out).toContain('WP_API_URL');
});

test('execDrop removes an mcp, unlinks tasks and persists', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, command: 'npx', args: [] }]);
  engine.config.tasks = { post: { enabled: true, schedule: 60, mcps: ['gloobeam'] } } as Config['tasks'];
  const cmd = new McpsCommand(engine, new Logger(), ['drop', 'gloobeam']);

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.mcps['gloobeam']).toBeUndefined();
  expect(config.tasks.post.mcps).toEqual([]);
});

test('execDrop warns for unknown mcp', async () => {
  const engine = buildEngine();
  const { logger, lines } = captureLogger();
  const cmd = new McpsCommand(engine, logger, ['drop', 'nope']);

  await cmd.exec();

  expect(lines.join('\n')).toContain('not found');
  expect(readConfig(engine).mcps).toEqual({});
});

test('execAdd validates, connects and persists an mcp from a pasted snippet', async () => {
  const engine = buildEngine();
  const { logger, lines } = captureLogger();
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, logger, ['add']);

  // scripted answers: name (no tasks configured -> no linking prompt)
  answers = ['gloobeam'];

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.mcps['gloobeam']).toBeDefined();
  expect(config.mcps['gloobeam'].command).toBe(process.execPath);
  expect(config.mcps['gloobeam'].env.MOCK_MCP_TOKEN).toBe('secret-token');
  expect(lines.join('\n')).toContain('mcp added');
});

test('execAdd links the mcp to selected tasks', async () => {
  const engine = buildEngine();
  engine.config.tasks = {
    post: { enabled: true, schedule: 3600 },
    digest: { enabled: true, schedule: 60 },
  } as Config['tasks'];
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, new Logger(), ['add']);

  // scripted answers: name -> checkbox ("1" links the first task only)
  answers = ['gloobeam', '1'];

  await cmd.exec();

  expect(engine.config.tasks!['post']!.mcps).toEqual(['gloobeam']);
  expect(engine.config.tasks!['digest']!.mcps).toBeUndefined();
});

test('execAdd rejects invalid json snippets', async () => {
  const engine = buildEngine();
  const { logger, lines } = captureLogger();
  injectedSnippet = '{not json';
  const cmd = new McpsCommand(engine, logger, ['add']);

  // scripted answers: name
  answers = ['gloobeam'];

  await cmd.exec();

  expect(lines.join('\n')).toContain('invalid json');
  expect(readConfig(engine).mcps).toEqual({});
});

test('execAdd rejects snippets without a command', async () => {
  const engine = buildEngine();
  const { logger, lines } = captureLogger();
  injectedSnippet = JSON.stringify({ args: ['-y', '@x/y'] });
  const cmd = new McpsCommand(engine, logger, ['add']);

  // scripted answers: name
  answers = ['gloobeam'];

  await cmd.exec();

  expect(lines.join('\n')).toContain('invalid mcp snippet');
  expect(readConfig(engine).mcps).toEqual({});
});

test('execAdd unwraps claude-style mcpServers snippets', async () => {
  const engine = buildEngine();
  injectedSnippet = JSON.stringify({ mcpServers: { gloobeam: MOCK_SPEC() } }, null, 2);
  const cmd = new McpsCommand(engine, new Logger(), ['add']);

  // scripted answers: name
  answers = ['gloobeam'];

  await cmd.exec();

  expect(readConfig(engine).mcps['gloobeam']).toBeDefined();
});

test('execAdd aborts on failed connection unless confirmed', async () => {
  const engine = buildEngine();
  const { logger, lines } = captureLogger();
  // command that exits immediately -> initialize fails
  injectedSnippet = JSON.stringify({ command: 'false', args: [] });
  const cmd = new McpsCommand(engine, logger, ['add']);

  // scripted answers: name -> confirm prompt ("n" = do not save anyway)
  answers = ['broken', 'n'];

  await cmd.exec();

  expect(lines.join('\n')).toContain('aborted');
  expect(readConfig(engine).mcps).toEqual({});
});

test('execEdit replaces the spawn spec and persists', async () => {
  const engine = buildEngine(['gloobeam', { enabled: false, command: 'old-cmd', args: [] }]);
  // edit reads the snippet from the multiline prompt (file arg is ignored)
  injectedSnippet = JSON.stringify(MOCK_SPEC(), null, 2);
  const cmd = new McpsCommand(engine, new Logger(), ['edit', 'gloobeam']);

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.mcps['gloobeam'].command).toBe(process.execPath);
  // previous enabled flag kept when the snippet does not set one
  expect(config.mcps['gloobeam'].enabled).toBe(false);
});

test('execInfo connects and prints the server tools', async () => {
  const engine = buildEngine(['gloobeam', MOCK_SPEC()]);
  const { logger, lines } = captureLogger();
  const cmd = new McpsCommand(engine, logger, ['info', 'gloobeam']);

  await cmd.exec();

  const out = lines.join('\n');
  expect(out).toContain('echo');
  expect(out).toContain('Echo the input text');
  expect(out).toContain('peek_env');
});
