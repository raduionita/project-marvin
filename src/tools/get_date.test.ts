import { test, expect } from 'bun:test';
import GetDateTool from './get_date.js';
import { Context } from '../types.js';

function mockContext(): Context {
  const ctx = new Context();
  return ctx;
}

test('getDate tool metadata', () => {
  const ctx = mockContext();
  const tool = new GetDateTool(ctx);
  const meta = tool.meta;
  expect(meta.function.name).toBe('getDate');
  expect(meta.function.description).toBe('Get the current date');
});

test('getDate without timestamp returns today', async () => {
  const ctx = mockContext();
  const tool = new GetDateTool(ctx);
  const result = await tool.call({});
  expect(typeof result).toBe('object');
  expect(Object.keys(result).length).toBe(1);
  expect(result.date.length).toBeGreaterThan(0);
});

test('getDate with timestamp returns correct date', async () => {
  const ctx = mockContext();
  const tool = new GetDateTool(ctx);
  const result = await tool.call({ timestamp: 0 });
  expect(typeof result).toBe('object');
  expect(result.date.length).toBeGreaterThan(0);
});
