import { test, expect } from 'bun:test';
import { Context } from './context.js';
import { Channel, Config, App } from './types.js';
import { Server } from './server.js';

// helpers

function mockConfig(channels: Config['channels'] = {}): Config {
  return {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 7331, logLevel: 'info' },
    channels: channels,
    models: {},
    agents: {},
  } as Config;
}

function mockServer(): Server {
  return new Server();
}

// tests

test('execChannels loads enabled channels with valid provider', async () => {
  const config = mockConfig({ 'channel.mock': { enabled: true } });
  const server = mockServer();

  server.initContext();
  await server.initConfig(config);
  await server.initChannels();

  expect(server.ctx!.channels['channel.mock']).toBeDefined();
  expect(server.ctx!.channels['channel.mock'] instanceof Channel).toBe(true);
});

test('execChannels skips disabled channels', async () => {
  const config = mockConfig({ disabledChannel: { enabled: false } });
  const server = mockServer();

  server.initContext();
  await server.initConfig(config);
  await server.initChannels();

  expect(server.ctx!.channels['disabledChannel']).toBeUndefined();
});

test('execChannels warns on missing provider', async () => {
  const config = mockConfig({ unknownProvider: { enabled: true } });
  const server = mockServer();

  server.initContext();
  await server.initConfig(config);
  await server.initChannels();


  expect(server.ctx!.channels['unknownProvider']).toBeUndefined();
});

test('execChannels skips non-Channel classes', async () => {
  const config = mockConfig({ badChannel: { enabled: true } });
  const server = mockServer();

  server.initContext();
  await server.initConfig(config);
  await server.initChannels();

  expect(server.ctx!.channels['badChannel']).toBeUndefined();
});

test('execChannels stores channels in ctx.channels', async () => {
  const config = mockConfig({ 'channel.mock': { enabled: true } });
  const server = mockServer();

  server.initContext();
  await server.initConfig(config);
  await server.initChannels();

  expect(Object.keys(server.ctx!.channels).length).toBeGreaterThan(0);
  expect(Object.keys(server.ctx!.channels)).toContain('channel.mock');
});
