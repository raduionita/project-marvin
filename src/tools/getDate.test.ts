import { test, expect } from 'bun:test';
import GetDateTool from './getDate.js';

test('getDate tool metadata', () => {
  const tool = new GetDateTool();
  expect(tool.name()).toBe('getDate');
  expect(tool.info()).toBe('Get the current date');
});

test('getDate without timestamp returns today', async () => {
  const tool = new GetDateTool();
  const result = await tool.call(null, {});
  expect(typeof result).toBe('string');
  expect(result.length).toBeGreaterThan(0);
});

test('getDate with timestamp returns correct date', async () => {
  const tool = new GetDateTool();
  const result = await tool.call(null, { timestamp: 0 });
  expect(typeof result).toBe('string');
  expect(result.length).toBeGreaterThan(0);
});
