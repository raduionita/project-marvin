import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import GetDateTool from './get_date.js';

function mockEngine(): Engine {
  const engine = new Engine();
  return engine;
}

test('getDate tool metadata', () => {
  const engine = mockEngine();
  const tool = new GetDateTool(engine);
  const meta = tool.meta;
  expect(meta.function.name).toBe('get_date');
  expect(meta.function.description).toBe('Get the current date');
});

test('getDate without timestamp returns today', async () => {
  const engine = mockEngine();
  const tool = new GetDateTool(engine);
  const result = await tool.call({});
  expect(typeof result).toBe('object');
  expect(Object.keys(result).length).toBe(1);
  expect(result.date.length).toBeGreaterThan(0);
});

test('getDate with timestamp returns correct date', async () => {
  const engine = mockEngine();
  const tool = new GetDateTool(engine);
  const result = await tool.call({ timestamp: 0 });
  expect(typeof result).toBe('object');
  expect(result.date.length).toBeGreaterThan(0);
});
