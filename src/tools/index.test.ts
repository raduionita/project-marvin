import { test, expect } from 'bun:test';
import { listTools } from './index.js';

test('listTools returns tool files', () => {
  const tools = listTools();
  expect(Array.isArray(tools)).toBe(true);
  expect(tools.length).toBeGreaterThan(0);
});

test('listTools excludes index.ts', () => {
  const tools = listTools();
  expect(tools).not.toContain('index.ts');
});

test('listTools excludes test files', () => {
  const tools = listTools();
  expect(tools).not.toContain('getDate.test.ts');
});

test('listTools includes known tools', () => {
  const tools = listTools();
  expect(tools).toContain('getDate.ts');
  expect(tools).toContain('webSearch.ts');
  expect(tools).toContain('webBrowse.ts');
});
