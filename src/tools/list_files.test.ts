import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import ListFilesTool from './list_files.js';

function mockEngine(): { engine: Engine; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'marvin-home-'));
  mkdirSync(join(home, 'files'), { recursive: true });
  const engine = new Engine();
  engine.work = home;
  return { engine, home };
}

function cleanup(home: string) {
  rmSync(home, { recursive: true, force: true });
}

test('listFiles tool metadata', () => {
  const { engine } = mockEngine();
  const tool = new ListFilesTool(engine);
  expect(tool.meta.function.name).toBe('list_files');
  expect(tool.meta.function.parameters.properties.path).toBeDefined();
  cleanup(engine.work);
});

test('listFiles lists the workspace root by default', async () => {
  const { engine, home } = mockEngine();
  const tool = new ListFilesTool(engine);
  mkdirSync(join(home, 'files', 'agents'));
  writeFileSync(join(home, 'files', 'notes.txt'), 'hello');
  writeFileSync(join(home, 'files', 'marvin.json'), '{}');

  const result = await tool.call({});

  expect(result.count).toBe(3);
  const names = (result.entries as { name: string; type: string }[]).map(e => e.name);
  expect(names).toContain('agents');
  expect(names).toContain('notes.txt');
  expect(names).toContain('marvin.json');
  const agents = (result.entries as { name: string; type: string }[]).find(e => e.name === 'agents');
  expect(agents?.type).toBe('dir');
  cleanup(home);
});

test('listFiles lists a subdirectory via relative path', async () => {
  const { engine, home } = mockEngine();
  const tool = new ListFilesTool(engine);
  mkdirSync(join(home, 'files', 'agents', 'agent-1'), { recursive: true });
  writeFileSync(join(home, 'files', 'agents', 'agent-1', 'IDENTITY.md'), 'id');

  const result = await tool.call({ path: 'agents/agent-1' });

  expect(result.count).toBe(1);
  const entries = result.entries as { name: string; type: string }[];
  expect(entries[0]?.name).toBe('IDENTITY.md');
  expect(entries[0]?.type).toBe('file');
  cleanup(home);
});

test('listFiles reports file sizes', async () => {
  const { engine, home } = mockEngine();
  const tool = new ListFilesTool(engine);
  writeFileSync(join(home, 'files', 'notes.txt'), 'hello world');

  const result = await tool.call({});

  const entries = result.entries as { name: string; type: string; size?: number }[];
  expect(entries[0]?.name).toBe('notes.txt');
  expect(entries[0]?.size).toBe(11);
  cleanup(home);
});

test('listFiles filters entries by pattern', async () => {
  const { engine, home } = mockEngine();
  const tool = new ListFilesTool(engine);
  writeFileSync(join(home, 'files', 'notes.txt'), 'a');
  writeFileSync(join(home, 'files', 'ideas.md'), 'b');
  writeFileSync(join(home, 'files', 'config.json'), 'c');

  const result = await tool.call({ pattern: '\\.(txt|md)$' });

  expect(result.count).toBe(2);
  const names = (result.entries as { name: string }[]).map(e => e.name).sort();
  expect(names).toEqual(['ideas.md', 'notes.txt']);
  cleanup(home);
});

test('listFiles rejects an invalid pattern', async () => {
  const { engine, home } = mockEngine();
  const tool = new ListFilesTool(engine);

  const result = await tool.call({ pattern: '[' });

  expect(result.error).toContain('invalid pattern');
  cleanup(home);
});

test('listFiles rejects absolute paths outside the workspace', async () => {
  const { engine, home } = mockEngine();
  const tool = new ListFilesTool(engine);

  const result = await tool.call({ path: '/etc' });

  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('listFiles rejects paths that escape via ..', async () => {
  const { engine, home } = mockEngine();
  const tool = new ListFilesTool(engine);

  const result = await tool.call({ path: join(home, '..', 'etc') });

  expect(result.error).toContain('outside the workspace');
  cleanup(home);
});

test('listFiles returns an error for a missing directory', async () => {
  const { engine, home } = mockEngine();
  const tool = new ListFilesTool(engine);

  const result = await tool.call({ path: 'does-not-exist' });

  expect(typeof result.error).toBe('string');
  cleanup(home);
});
