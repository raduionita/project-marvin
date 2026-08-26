import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Engine from './engine.js';
import { Logger } from './logger.js';
import { Chat, Config, Task } from './types.js';
import { Agent } from './agent.js';
import * as constants from './constants.js';

function buildEngine(): Engine {
  const engine = new Engine(new Logger());
  engine.state = 'load';
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-engine-'));
  engine.config = {
    settings: { name: 'marvin', host: '127.0.0.1', port: 7331, logLevel: 'info', apiToken: 'changeme' },
    channels: {},
    integrations: {},
    models: {},
    agents: {},
    tasks: {},
    mcps: {},
  } as Config;
  return engine;
}

function chatWith(messages: Chat['messages']): Chat {
  return { id: 'c', thinking: false, messages, updated: Date.now() };
}

test('execSweep removes chats idle longer than the TTL and reschedules', async () => {
  const engine = buildEngine();
  engine.state = 'exec';
  engine.agents['marvin'] = new Agent(engine, new Logger(), {
    id: 'marvin',
    enabled: true,
    identity: '',
    channels: {},
    model: {} as never,
  });
  engine.tasks['sweep'] = {
    id: 'sweep',
    enabled: true,
    type: 'sweep',
    agent: engine.agents['marvin'],
    schedule: 1000,
    maxSteps: 0,
    timeout: null,
  } as Task;

  const agent = engine.agents['marvin']!;
  const stale = chatWith([{ role: 'user', content: 'old' }]);
  agent.saveChat('stale', stale);
  stale.updated = Date.now() - constants.CHAT_TTL_MS - 1000;

  const fresh = chatWith([{ role: 'user', content: 'new' }]);
  agent.saveChat('fresh', fresh);

  await engine.execSweep('sweep');

  // stale was evicted: loadChat returns a fresh chat (no 'old' message)
  const staleChat = agent.loadChat('stale');
  expect(staleChat.messages.filter(m => m.content === 'old').length).toBe(0);

  // fresh is still cached with its 'new' message
  const freshChat = agent.loadChat('fresh');
  expect(freshChat.messages.some(m => m.content === 'new')).toBe(true);

  // rescheduled for the next run
  const task = engine.tasks['sweep']!;
  expect(task.timeout).not.toBeNull();
  clearTimeout(task.timeout!);
  rmSync(engine.work, { recursive: true, force: true });
});
