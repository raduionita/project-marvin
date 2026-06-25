import { test, expect } from 'bun:test';
import { Context } from './context.js';
import { Channel, Config } from './types.js';

// helpers

function mockContext(channelsConfig: Config['channels'] = {}): Context {
  const ctx = new Context();
  ctx.config = {
    timestamp: Date.now(),
    settings: { name: 'marvin', port: 19384, logLevel: 'info' },
    channels: channelsConfig,
    models: {},
    agents: {},
  } as Config;
  ctx.channels = {};
  ctx.models = {};
  ctx.agents = {};
  ctx.tools = {};
  ctx.state = 'running';
  return ctx;
}

// tests

test('initChannels loads enabled channels with valid provider', async () => {
  const ctx = mockContext({ 'channel.mock': { enabled: true } });

  const { initChannels } = await import('./daemon.js');
  await initChannels(ctx);

  expect(ctx.channels['channel.mock']).toBeDefined();
  expect(ctx.channels['channel.mock'] instanceof Channel).toBe(true);
});

test('initChannels skips disabled channels', async () => {
  const ctx = mockContext({ disabledChannel: { enabled: false } });

  const { initChannels } = await import('./daemon.js');
  await initChannels(ctx);

  expect(ctx.channels['disabledChannel']).toBeUndefined();
});

test('initChannels warns on missing provider', async () => {
  const ctx = mockContext({ unknownProvider: { enabled: true } });

  const { initChannels } = await import('./daemon.js');
  await initChannels(ctx);

  expect(ctx.channels['unknownProvider']).toBeUndefined();
});

test('initChannels skips non-Channel classes', async () => {
  const ctx = mockContext({ badChannel: { enabled: true } });

  const { initChannels } = await import('./daemon.js');
  await initChannels(ctx);

  expect(ctx.channels['badChannel']).toBeUndefined();
});

test('initChannels stores channels in ctx.channels', async () => {
  const ctx = mockContext({ 'channel.mock': { enabled: true } });

  const { initChannels } = await import('./daemon.js');
  await initChannels(ctx);

  expect(Object.keys(ctx.channels).length).toBeGreaterThan(0);
  expect(Object.keys(ctx.channels)).toContain('channel.mock');
});
