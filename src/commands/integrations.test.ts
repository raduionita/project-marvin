import { test, expect } from 'bun:test';
import { writeFileSync } from 'fs';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../types.js';
import Engine from '../engine.js';
import IntegrationsCommand from './integrations.js';

function buildEngine(...integrations: [string, { [key: string]: any }][]): Engine {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  const config = {
    settings: { name: 'marvin', port: 7331, host: '127.0.0.1', logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: Object.fromEntries(integrations) as Config['integrations'],
    models: {},
    agents: {},
  } as Config;
  writeFileSync(join(engine.work, 'marvin.json'), JSON.stringify(config, null, 2));
  engine.config = config;
  return engine;
}

function readConfig(engine: Engine): { [key: string]: any } {
  return JSON.parse(readFileSync(join(engine.work, 'marvin.json'), 'utf8'));
}

test('execList lists configured integrations', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, type: 'wordpress', endpoint: 'https://example.com' }]);
  const cmd = new IntegrationsCommand(engine, ['list']);

  const infoLogs: string[] = [];
  const orig = console.info;
  console.info = (...args: any[]) => infoLogs.push(args.join(' '));
  try {
    await cmd.exec();
  } finally {
    console.info = orig;
  }

  expect(infoLogs.join('\n')).toContain('gloobeam');
  expect(infoLogs.join('\n')).toContain('wordpress');
});

test('execDrop removes an integration and persists to marvin.json', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, type: 'wordpress', endpoint: 'https://example.com' }]);
  const cmd = new IntegrationsCommand(engine, ['drop', 'gloobeam']);

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.integrations['gloobeam']).toBeUndefined();
});

test('execDrop warns for unknown integration', async () => {
  const engine = buildEngine();
  const cmd = new IntegrationsCommand(engine, ['drop', 'nope']);

  const errorLogs: string[] = [];
  const orig = console.error;
  console.error = (...args: any[]) => errorLogs.push(args.join(' '));
  try {
    await cmd.exec();
  } finally {
    console.error = orig;
  }

  expect(errorLogs.join('\n')).toContain('not found');
  expect(readConfig(engine).integrations).toEqual({});
});