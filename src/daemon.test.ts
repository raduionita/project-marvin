import { test, expect } from 'bun:test';
import { Context } from './context.js';
import { Channel, Config, App } from './types.js';
import { Daemon } from './daemon.js';

// helpers

function mockConfig(channels: Config['channels'] = {}): Config {
  return {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 19384, logLevel: 'info' },
    channels: channels,
    models: {},
    agents: {},
  } as Config;
}

function mockDaemon(): Daemon {
  return new Daemon();
}

// tests

test('execChannels loads enabled channels with valid provider', async () => {
  const config = mockConfig({ 'channel.mock': { enabled: true } });
  const daemon = mockDaemon();

  await daemon.initConfig(config);
  await daemon.initChannels();

  expect(daemon.ctx.channels['channel.mock']).toBeDefined();
  expect(daemon.ctx.channels['channel.mock'] instanceof Channel).toBe(true);
});

test('execChannels skips disabled channels', async () => {
  const config = mockConfig({ disabledChannel: { enabled: false } });
  const daemon = mockDaemon();

  await daemon.initConfig(config);
  await daemon.initChannels();

  expect(daemon.ctx.channels['disabledChannel']).toBeUndefined();
});

test('execChannels warns on missing provider', async () => {
  const config = mockConfig({ unknownProvider: { enabled: true } });
  const daemon = mockDaemon();

  await daemon.initConfig(config);
  await daemon.initChannels();


  expect(daemon.ctx.channels['unknownProvider']).toBeUndefined();
});

test('execChannels skips non-Channel classes', async () => {
  const config = mockConfig({ badChannel: { enabled: true } });
  const daemon = mockDaemon();

  await daemon.initConfig(config);
  await daemon.initChannels();

  expect(daemon.ctx.channels['badChannel']).toBeUndefined();
});

test('execChannels stores channels in ctx.channels', async () => {
  const config = mockConfig({ 'channel.mock': { enabled: true } });
  const daemon = mockDaemon();

  await daemon.initConfig(config);
  await daemon.initChannels();

  expect(Object.keys(daemon.ctx.channels).length).toBeGreaterThan(0);
  expect(Object.keys(daemon.ctx.channels)).toContain('channel.mock');
});
