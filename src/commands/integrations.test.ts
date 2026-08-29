import { mock, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Config } from '../types.js';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { buildPromptMocks, captureLogger } from '../tests.js';

// scripted answers consumed by the mocked @inquirer/prompts prompts. selects
// interpret the answer as a 1-based option index (the old numbered fallback).
let answers: string[] = [];
const promptMocks = buildPromptMocks(() => answers);
mock.module('@inquirer/prompts', () => promptMocks);

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
    tasks: {},
    mcps: {},
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

test('execDrop prompts via rawList when no <name> arg is given', async () => {
  const engine = buildEngine(
    ['gloobeam', { enabled: true, type: 'wordpress' }],
    ['hubspot', { enabled: true, type: 'wordpress' }],
  );
  const cmd = new IntegrationsCommand(engine, new Logger(), ['drop']);

  // 3 choices (gloobeam, hubspot, cancel) -> pick "1"=gloobeam
  answers = ['1'];

  await cmd.exec();

  expect(readConfig(engine).integrations['gloobeam']).toBeUndefined();
  expect(readConfig(engine).integrations['hubspot']).toBeDefined();
});

test('execDrop bails when the user picks "cancel" from rawList', async () => {
  const engine = buildEngine(['gloobeam', { enabled: true, type: 'wordpress' }]);
  const { logger, lines } = captureLogger();
  const cmd = new IntegrationsCommand(engine, logger, ['drop']);

  // 2 choices (gloobeam, cancel) -> pick "2"=cancel
  answers = ['2'];

  await cmd.exec();

  expect(lines.join('\n')).toContain('no integration selected');
  expect(readConfig(engine).integrations['gloobeam']).toBeDefined();
});

test('execDrop warns for unknown integration', async () => {
  const engine = buildEngine();
  const { logger, lines } = captureLogger();
  const cmd = new IntegrationsCommand(engine, logger, ['drop', 'nope']);

  await cmd.exec();

  expect(lines.join('\n')).toContain('not found');
  expect(readConfig(engine).integrations).toEqual({});
});

// --- discovery-driven add wizard ---

// stub the Wordpress OPTIONS discovery so the wizard is deterministic
function mockWordpressDiscovery() {
  globalThis.fetch = ((url: any, init?: any) => {
    const isOptions = init?.method === 'OPTIONS';
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        endpoints: [
          { methods: ['GET'], args: { context: { type: 'string' } } },
          {
            methods: ['POST'],
            args: {
              title: { type: 'string', required: true, description: 'The title' },
              content: { type: 'string', description: 'The content' },
            },
          },
        ],
      })),
      json: () => Promise.resolve({}),
    } as Response);
  }) as typeof fetch;
}

test('execAdd configures an integration via the discovery wizard', async () => {
  mockWordpressDiscovery();
  const engine = buildEngine();
  const { logger, lines } = captureLogger();
  const cmd = new IntegrationsCommand(engine, logger, ['add']);

  // scripted answers: name -> type ("1"=wordpress) -> endpoint -> user ->
  // appPassword -> action ("1"=list_posts) -> fields ("1,2") -> required
  // (blank = all) -> action ("6"=finish, after list_posts is removed) ->
  // meta loop (blank)
  answers = ['gloobeam', '1', 'https://gloobeam.com', 'admin', 'secret', '1', '1,2', '', '6', ''];

  await cmd.exec();

  const config = readConfig(engine);
  const integration = config.integrations['gloobeam'];
  expect(integration).toBeDefined();
  expect(integration.type).toBe('wordpress');
  expect(integration.endpoint).toBe('https://gloobeam.com');
  expect(integration.enabled).toBe(true);
  expect(integration.actions.list_posts).toBeDefined();
  expect(integration.actions.list_posts.fields.title).toBeDefined();
  expect(lines.join('\n')).toContain('configured');
});

test('execAdd registers meta fields from the wizard', async () => {
  mockWordpressDiscovery();
  const engine = buildEngine();
  const cmd = new IntegrationsCommand(engine, new Logger(), ['add', 'gloobeam', 'wordpress']);

  // name+type given via args: endpoint -> user -> appPassword -> action ("1")
  // -> field select ("1,2") -> required (blank) -> finish -> meta name
  // "custom_author" -> type ("string") -> description -> blank stops
  answers = ['https://gloobeam.com', 'admin', 'secret', '1', '1,2', '', '6', 'custom_author', 'string', 'Byline', ''];

  await cmd.exec();

  const integration = readConfig(engine).integrations['gloobeam'];
  expect(integration.meta.fields.custom_author).toBeDefined();
  expect(integration.meta.fields.custom_author.type).toBe('string');
});

test('execInfo previews the discovered config without persisting', async () => {
  mockWordpressDiscovery();
  const engine = buildEngine(['gloobeam', { enabled: true, type: 'wordpress', endpoint: 'https://gloobeam.com' }]);
  const { logger, lines } = captureLogger();
  const cmd = new IntegrationsCommand(engine, logger, ['info', 'gloobeam']);

  await cmd.exec();

  const out = lines.join('\n');
  expect(out).toContain('config preview');
  expect(out).toContain('create_post');
  expect(out).toContain('"title"');
  expect(out).toContain('not persisted');
  // nothing written to marvin.json beyond the original config
  expect(readConfig(engine).integrations['gloobeam'].actions).toBeUndefined();
});

test('execAdd links the integration to selected tasks', async () => {
  mockWordpressDiscovery();
  const engine = buildEngine();
  engine.config.tasks = {
    post: { enabled: true, agent: 'journalist', schedule: 3600, maxSteps: 5 },
    digest: { enabled: true, agent: 'journalist', schedule: 60, maxSteps: 5 },
  } as Config['tasks'];
  const cmd = new IntegrationsCommand(engine, new Logger(), ['add', 'gloobeam', 'wordpress']);

  // name+type via args: endpoint -> user -> appPassword -> action ("1") ->
  // fields ("1,2") -> required (blank) -> finish -> meta blank -> task ("1"=post)
  // (digest stays unlinked)
  answers = ['https://gloobeam.com', 'admin', 'secret', '1', '1,2', '', '6', '', '1'];

  await cmd.exec();

  expect(engine.config.tasks!['post']!.integrations).toEqual(['gloobeam']);
  expect(engine.config.tasks!['digest']!.integrations).toBeUndefined();
  expect(readConfig(engine).integrations['gloobeam']).toBeDefined();
});

test('execAdd lists nested sub-fields with dotted paths in the required prompt', async () => {
  // discovery returns an object field with sub-properties
  globalThis.fetch = ((url: any, init?: any) => {
    if (init?.method === 'OPTIONS') {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          endpoints: [
            { methods: ['GET'], args: {} },
            {
              methods: ['POST'],
              args: {
                slug: { type: 'string', description: 'The slug' },
                meta: {
                  type: 'object',
                  properties: {
                    keywords: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          ],
        })),
        json: () => Promise.resolve({}),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}'), json: () => Promise.resolve({}) } as Response);
  }) as typeof fetch;

  const engine = buildEngine();
  const cmd = new IntegrationsCommand(engine, new Logger(), ['add']);

  // name -> type ("1"=wordpress) -> endpoint -> user -> appPassword ->
  // action ("1"=list_posts) -> fields ("1,2"=slug,meta) -> required (blank =
  // all) -> finish ("6") -> meta loop (blank)
  answers = ['gloobeam', '1', 'https://gloobeam.com', 'admin', 'secret', '1', '1,2', '', '6', ''];

  await cmd.exec();

  // the required checkbox lists every picked field with its dotted path + type
  type CheckboxConfig = { message: string, choices: { name: string }[] };
  const checkboxCalls = ((promptMocks.checkbox as any).mock.calls as CheckboxConfig[][]);
  const required = checkboxCalls.map(call => call[0]!).filter(cfg => cfg.message.includes('Mark required fields')).at(-1)!;
  expect(required.choices.map(c => c.name)).toContain('gloobeam.slug (string):');
  expect(required.choices.map(c => c.name)).toContain('gloobeam.meta.keywords (array):');

  // nested sub-fields are persisted with dotted keys
  const fields = readConfig(engine).integrations['gloobeam'].actions.list_posts.fields;
  expect(fields['meta.keywords']).toBeDefined();
  expect(fields['meta.keywords'].type).toBe('array');
  expect(fields['meta.keywords'].required).toBe(true);
});
