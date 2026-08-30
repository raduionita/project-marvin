import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import { Model, Config, Chat, Reply, Task } from '../types.js';
import { Agent } from '../agent.js';
import MarvinStateTool from './marvin_state.js';

class FakeModel extends Model {
  constructor(engine: Engine, config: { [key: string]: any }) {
    super(engine, config);
  }
  async execChat(_chat: Chat): Promise<Reply> {
    return { id: 'fake', stop: true, message: { role: 'assistant', content: 'hi' }, usage: { prompt: 0, completion: 0 } };
  }
}

function mockEngine(): Engine {
  const engine = new Engine();
  engine.config = {
    settings: { name: 'marvin', host: '127.0.0.1', port: 7331, logLevel: 'info', apiToken: 'changeme' },
    channels: { slack: { enabled: true }, telegram: { enabled: false } },
    integrations: { gloobeam: { enabled: true, type: 'wordpress' } },
    models: { llm: { enabled: true, provider: 'deepseek', model: 'deepseek-chat' } },
    agents: {},
    tasks: {},
    mcps: {},
  } as Config;

  engine.models['llm'] = new FakeModel(engine, { enabled: true, provider: 'deepseek', model: 'deepseek-chat' });

  engine.agents['marvin'] = new Agent(engine, {
    id: 'marvin',
    enabled: true,
    identity: 'orchestrator',
    channels: { slack: 'C1' },
    model: engine.models['llm'] as Model,
  });

  engine.tasks['status'] = {
    id: 'status',
    enabled: true,
    type: 'monitor',
    agent: engine.agents['marvin'],
    schedule: 3600000,
    timeout: null,
    maxSteps: 3,
    input: 'status',
  } as Task;

  return engine;
}

test('marvinState tool metadata', () => {
  const engine = mockEngine();
  const tool = new MarvinStateTool(engine);
  expect(tool.meta.function.name).toBe('marvin_state');
  expect(tool.meta.function.description).toContain('runtime state');
});

test('marvinState returns a full summary', async () => {
  const engine = mockEngine();
  const tool = new MarvinStateTool(engine);

  const result = await tool.call({});

  expect(result.agents['marvin'].enabled).toBe(true);
  expect(result.agents['marvin'].model).toBe('deepseek-chat');
  expect(result.tasks['marvin/status'].schedule).toBe(3600000);
  expect(result.models['llm'].provider).toBe('deepseek');
  expect(result.channels['slack'].enabled).toBe(true);
  expect(result.integrations['gloobeam'].type).toBe('wordpress');
  expect(result.settings.name).toBe('marvin');
});

test('marvinState filters by area', async () => {
  const engine = mockEngine();
  const tool = new MarvinStateTool(engine);

  const agents = await tool.call({ area: 'agents' });
  expect(agents.agents).toBeDefined();
  expect(agents.tasks).toBeUndefined();

  const models = await tool.call({ area: 'models' });
  expect(models.models['llm'].model).toBe('deepseek-chat');
  expect(models.agents).toBeUndefined();
});

test('marvinState reports an unknown area', async () => {
  const engine = mockEngine();
  const tool = new MarvinStateTool(engine);

  const result = await tool.call({ area: 'bogus' });
  expect(result.error).toContain('unknown area');
});

test('marvinState handles an empty engine', async () => {
  const engine = new Engine();
  const tool = new MarvinStateTool(engine);

  const result = await tool.call({});
  expect(result.agents).toEqual({});
  expect(result.models).toEqual({});
  expect(result.tasks).toEqual({});
});
