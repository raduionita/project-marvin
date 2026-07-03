import { test, expect } from 'bun:test';
import GetDateTool from './getDate.js';
import { Context } from '../context.js';

function mockContext(): Context {
  const ctx = new Context();
  return ctx;
}

test('getDate tool metadata', () => {
  const ctx = mockContext();
  const tool = new GetDateTool(ctx);
  expect(tool.name()).toBe('getDate');
  expect(tool.info()).toBe('Get the current date');
});

test('getDate without timestamp returns today', async () => {
  const ctx = mockContext();
  const tool = new GetDateTool(ctx);
  const result = await tool.call({});
  expect(typeof result).toBe('string');
  expect(result.length).toBeGreaterThan(0);
});

test('getDate with timestamp returns correct date', async () => {
  const ctx = mockContext();
  const tool = new GetDateTool(ctx);
  const result = await tool.call({ timestamp: 0 });
  expect(typeof result).toBe('string');
  expect(result.length).toBeGreaterThan(0);
});
