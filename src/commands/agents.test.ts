import { mock, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../types.js';
import * as constants from '../constants.js';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { buildPromptMocks, captureLogger } from '../helpers/tests.js';

// scripted answers consumed by the mocked @inquirer/prompts prompts
let answers: string[] = [];
const promptMocks = buildPromptMocks(() => answers);
mock.module('@inquirer/prompts', () => promptMocks);

import AgentsCommand from './agents.js';

function mockConfig(models: Config['models'], channels: Config['channels']): Config {
  return {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels,
    models,
    agents: {},
    tasks: {},
    mcps: {},
  } as Config;
}

// tool groups available after execAdd loads engine tools (control excluded, always loaded)
function toolGroups(engine: Engine): string[] {
  return [...new Set(Object.values(engine.tools).map(t => t.meta.group))]
    .filter(g => g !== 'control')
    .sort();
}

test('agents add writes IDENTITY.md and persists config', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    { slack: { enabled: true } },
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent', '', '1', 'general', 'I am a test agent'];
  await cmd.execAdd();

  // IDENTITY.md created with the provided identity
  const ipath = join(engine.work, 'agents', 'my-agent', 'IDENTITY.md');
  expect(existsSync(ipath)).toBe(true);
  expect(readFileSync(ipath, 'utf8').trim()).toBe('I am a test agent');

  // config entry persisted (tools checkbox defaults to all groups)
  expect(engine.config.agents['my-agent']).toEqual({
    enabled: true,
    model: 'openai/gpt-4o-mini',
    channels: { slack: 'general' },
    tools: toolGroups(engine),
  });

  // config file persisted too
  const cpath = join(engine.work, 'marvin.json');
  expect(existsSync(cpath)).toBe(true);
});

test('agents add aborts when no tool groups are selected', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent', '', '', '99'];
  await cmd.execAdd();

  expect(engine.config.agents['my-agent']).toBeUndefined();
  expect(existsSync(join(engine.work, 'agents', 'my-agent'))).toBe(false);
});

test('agents add refuses existing agent', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );
  engine.config.agents['my-agent'] = { enabled: true, model: 'openai/gpt-4o-mini', channels: {} };

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent'];
  await cmd.execAdd();

  // still single entry, identity dir untouched
  expect(Object.keys(engine.config.agents)).toEqual(['my-agent']);
  expect(existsSync(join(engine.work, 'agents', 'my-agent'))).toBe(false);
});

test('agents add uses default identity when blank', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent', '', '', ''];
  await cmd.execAdd();

  const ipath = join(engine.work, 'agents', 'my-agent', 'IDENTITY.md');
  expect(readFileSync(ipath, 'utf8').trim()).toBe(constants.IDENTITY_MD.trim());
});

test('agents add picks the group from cached channel info', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    { slack: { enabled: true, groups: { C1: 'general', C2: 'random' } } },
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent', '', '', 'C2', 'I am a test agent'];
  await cmd.execAdd();

  expect(engine.config.agents['my-agent']).toEqual({
    enabled: true,
    model: 'openai/gpt-4o-mini',
    channels: { slack: 'C2' },
    tools: toolGroups(engine),
  });
});

// seed an editable agent (config entry + IDENTITY.md)
function seedAgent(engine: Engine, agentId: string, agent: Config['agents'][string], identity: string) {
  engine.config.agents[agentId] = agent;
  const apath = join(engine.work, 'agents', agentId);
  mkdirSync(apath, { recursive: true });
  writeFileSync(join(apath, 'IDENTITY.md'), identity + '\n');
}

// sorted non-control groups, probed from a throwaway engine (mirrors pickTools)
async function probeGroups(): Promise<string[]> {
  const probe = new Engine();
  probe.work = mkdtempSync(join(tmpdir(), 'marvin-probe-'));
  probe.config = mockConfig({}, {});
  await probe.loadMcps();
  await probe.loadTools();
  return toolGroups(probe);
}

test('agents edit updates identity/channels/tools, keeping the model', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    { slack: { enabled: true } },
  );
  seedAgent(engine, 'my-agent',
    { enabled: true, model: 'openai/gpt-4o-mini', channels: { slack: 'old-group' }, tools: ['web'] },
    'Old identity');

  const cmd = new AgentsCommand(engine, ['edit', 'my-agent']);
  // model (keep), channels (slack), group (keep), identity (new), tools (first two groups)
  answers = ['', '1', '', 'New identity', '1,2'];
  await cmd.execEdit();

  expect(readFileSync(join(engine.work, 'agents', 'my-agent', 'IDENTITY.md'), 'utf8').trim()).toBe('New identity');
  expect(engine.config.agents['my-agent']).toEqual({
    enabled: true,
    model: 'openai/gpt-4o-mini',
    channels: { slack: 'old-group' },
    tools: toolGroups(engine).slice(0, 2),
  });
});

test('agents edit keeps current values when answers are blank', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    { slack: { enabled: true } },
  );
  seedAgent(engine, 'my-agent',
    { enabled: true, model: 'openai/gpt-4o-mini', channels: { slack: 'C1' }, tools: ['web'] },
    'Old identity');

  // tools answer targets the current 'web' group index (keeps tools unchanged)
  const webIdx = (await probeGroups()).indexOf('web') + 1;
  expect(webIdx).toBeGreaterThan(0);

  const cmd = new AgentsCommand(engine, ['edit', 'my-agent']);
  answers = ['', '1', '', '', String(webIdx)];
  await cmd.execEdit();

  expect(readFileSync(join(engine.work, 'agents', 'my-agent', 'IDENTITY.md'), 'utf8').trim()).toBe('Old identity');
  expect(engine.config.agents['my-agent']).toEqual({
    enabled: true,
    model: 'openai/gpt-4o-mini',
    channels: { slack: 'C1' },
    tools: ['web'],
  });
});

test('agents edit aborts when no tool groups are selected', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );
  seedAgent(engine, 'my-agent',
    { enabled: true, model: 'openai/gpt-4o-mini', channels: {}, tools: ['web'] },
    'Old identity');

  const cmd = new AgentsCommand(engine, ['edit', 'my-agent']);
  answers = ['', '', '99'];
  await cmd.execEdit();

  // config and identity untouched
  expect(engine.config.agents['my-agent']).toEqual({
    enabled: true,
    model: 'openai/gpt-4o-mini',
    channels: {},
    tools: ['web'],
  });
  expect(readFileSync(join(engine.work, 'agents', 'my-agent', 'IDENTITY.md'), 'utf8').trim()).toBe('Old identity');
});

test('agents edit errors for unknown agents', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );

  const cmd = new AgentsCommand(engine, ['edit', 'nope']);
  answers = [];
  await cmd.execEdit();

  expect(Object.keys(engine.config.agents)).toEqual([]);
});

test('agents edit warns when no agents are configured', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );

  const cmd = new AgentsCommand(engine, ['edit']);
  answers = [];
  await cmd.execEdit();

  expect(Object.keys(engine.config.agents)).toEqual([]);
});

test('exec routes help, add, edit and unknown commands', async () => {
  const { lines, restore } = captureLogger();

  // help lists the subcommands
  const helpEngine = new Engine();
  helpEngine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  helpEngine.config = mockConfig({}, {});
  await new AgentsCommand(helpEngine, []).exec();
  expect(lines.join('\n')).toContain('edit');

  // unknown command warns (and falls through to help)
  lines.length = 0;
  await new AgentsCommand(helpEngine, ['frobnicate']).exec();
  expect(lines.join('\n')).toContain('unknown command');
  restore();
});

test('exec routes add (agent id from prompt)', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );

  // name, model (default), identity (default), tools (all)
  answers = ['my-agent', '', '', ''];
  await new AgentsCommand(engine, ['add']).exec();

  expect(engine.config.agents['my-agent']).toBeDefined();
  expect(existsSync(join(engine.work, 'agents', 'my-agent', 'IDENTITY.md'))).toBe(true);
});

test('agents add rejects invalid names', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['bad name!'];
  await cmd.execAdd();

  expect(Object.keys(engine.config.agents)).toEqual([]);
  expect(existsSync(join(engine.work, 'agents'))).toBe(false);
});

test('agents add errors when no models are configured', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({}, {});

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent'];
  await cmd.execAdd();

  expect(engine.config.agents['my-agent']).toBeUndefined();
  expect(existsSync(join(engine.work, 'agents', 'my-agent'))).toBe(false);
});

test('agents add creates control-only agents when no tool groups exist', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );
  // stub the loaders so no tool groups are available (control only)
  engine.loadMcps = async () => {};
  engine.loadTools = async () => {};

  const cmd = new AgentsCommand(engine, []);
  // name, model (default), identity (default) - no tools prompt when no groups
  answers = ['my-agent', '', ''];
  await cmd.execAdd();

  expect(engine.config.agents['my-agent']).toEqual({
    enabled: true,
    model: 'openai/gpt-4o-mini',
    channels: {},
    tools: [],
  });
});

test('agents edit changes the model', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    {
      'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' },
      'openai/gpt-5': { enabled: true, provider: 'openai', model: 'gpt-5' },
    },
    {},
  );
  seedAgent(engine, 'my-agent',
    { enabled: true, model: 'openai/gpt-4o-mini', channels: {}, tools: ['web'] },
    'Old identity');

  const cmd = new AgentsCommand(engine, ['edit', 'my-agent']);
  // model (second), identity (keep), tools (all)
  answers = ['2', '', ''];
  await cmd.execEdit();

  expect(engine.config.agents['my-agent']!.model).toBe('openai/gpt-5');
  expect(engine.config.agents['my-agent']!.tools).toEqual(toolGroups(engine));
});

test('agents edit drops unselected channels', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    { slack: { enabled: true }, telegram: { enabled: true } },
  );
  seedAgent(engine, 'my-agent',
    { enabled: true, model: 'openai/gpt-4o-mini', channels: { slack: 'C1', telegram: 'C2' }, tools: ['web'] },
    'Old identity');

  const cmd = new AgentsCommand(engine, ['edit', 'my-agent']);
  // model (keep), channels (telegram only), group (keep), identity (keep), tools (all)
  answers = ['', '2', '', '', ''];
  await cmd.execEdit();

  expect(engine.config.agents['my-agent']!.channels).toEqual({ telegram: 'C2' });
});

test('agents edit prompts to select the agent', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    { slack: { enabled: true } },
  );
  seedAgent(engine, 'my-agent',
    { enabled: true, model: 'openai/gpt-4o-mini', channels: {}, tools: ['web'] },
    'Old identity');

  const cmd = new AgentsCommand(engine, ['edit']);
  // agent, model (keep), channels (slack), group (new), identity (new), tools (all)
  answers = ['my-agent', '', '1', 'C9', 'Prompted edit', ''];
  await cmd.execEdit();

  expect(engine.config.agents['my-agent']!.channels).toEqual({ slack: 'C9' });
  expect(readFileSync(join(engine.work, 'agents', 'my-agent', 'IDENTITY.md'), 'utf8').trim()).toBe('Prompted edit');
});

test('agents edit changes the group from cached channel info', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    { slack: { enabled: true, groups: { C1: 'general', C2: 'random' } } },
  );
  seedAgent(engine, 'my-agent',
    { enabled: true, model: 'openai/gpt-4o-mini', channels: { slack: 'C1' }, tools: ['web'] },
    'Old identity');

  const cmd = new AgentsCommand(engine, ['edit', 'my-agent']);
  // model (keep), channels (slack), group (C2 from cache), identity (keep), tools (all)
  answers = ['', '1', 'C2', '', ''];
  await cmd.execEdit();

  expect(engine.config.agents['my-agent']!.channels).toEqual({ slack: 'C2' });
});

test('agents edit falls back to default identity when IDENTITY.md is missing', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    {},
  );
  // config entry only, no IDENTITY.md on disk
  engine.config.agents['my-agent'] = { enabled: true, model: 'openai/gpt-4o-mini', channels: {}, tools: ['web'] };

  const cmd = new AgentsCommand(engine, ['edit', 'my-agent']);
  // model (keep), identity (keep -> default), tools (all)
  answers = ['', '', ''];
  await cmd.execEdit();

  expect(readFileSync(join(engine.work, 'agents', 'my-agent', 'IDENTITY.md'), 'utf8').trim()).toBe(constants.IDENTITY_MD.trim());
});

test('agents chat warns on empty messages', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig({}, {});
  const { lines, restore } = captureLogger();

  const cmd = new AgentsCommand(engine, ['chat']);
  answers = [''];
  await cmd.execChat();

  expect(lines.join('\n')).toContain('empty message');
  restore();
});

test('agents add falls back to manual group entry via the (type manually) choice', async () => {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.config = mockConfig(
    { 'openai/gpt-4o-mini': { enabled: true, provider: 'openai', model: 'openai-chat' } },
    { slack: { enabled: true, groups: { C1: 'general' } } },
  );

  const cmd = new AgentsCommand(engine, []);
  answers = ['my-agent', '', '', '__manual__', 'C9', 'I am a test agent'];
  await cmd.execAdd();

  expect(engine.config.agents['my-agent']!.channels.slack).toBe('C9');
});
