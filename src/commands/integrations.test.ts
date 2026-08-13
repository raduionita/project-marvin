import { test, expect } from 'bun:test';
import { writeFileSync } from 'fs';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../types.js';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import IntegrationsCommand from './integrations.js';

function buildEngine(...integrations: [string, { [key: string]: any }][]): Engine {
  const engine = new Engine(new Logger());
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

// a logger that captures every emitted line (info-level and up), so tests can
// assert on command output without patching console.*
function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = new Logger({ level: 'info', output: (_level, args) => lines.push(args.map(String).join(' ')) });
  return { logger, lines };
}

test('execList lists configured integrations', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, type: 'wordpress', endpoint: 'https://example.com' }]);
  const { logger, lines } = captureLogger();
  const cmd = new IntegrationsCommand(engine, logger, ['list']);

  await cmd.exec();

  expect(lines.join('\n')).toContain('gloobeam');
  expect(lines.join('\n')).toContain('wordpress');
});

test('execDrop removes an integration and persists to marvin.json', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, type: 'wordpress', endpoint: 'https://example.com' }]);
  const cmd = new IntegrationsCommand(engine, new Logger(), ['drop', 'gloobeam']);

  await cmd.exec();

  const config = readConfig(engine);
  expect(config.integrations['gloobeam']).toBeUndefined();
});

test('execDrop warns for unknown integration', async () => {
  const engine = buildEngine();
  const { logger, lines } = captureLogger();
  const cmd = new IntegrationsCommand(engine, logger, ['drop', 'nope']);

  await cmd.exec();

  expect(lines.join('\n')).toContain('not found');
  expect(readConfig(engine).integrations).toEqual({});
});