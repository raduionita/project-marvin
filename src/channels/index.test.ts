import { test, expect } from 'bun:test';
import { listChannels } from './index.js';

test('listChannels returns channel files', () => {
  const channels = listChannels();
  expect(Array.isArray(channels)).toBe(true);
  expect(channels.length).toBeGreaterThan(0);
});

test('listChannels excludes index.ts', () => {
  const channels = listChannels();
  expect(channels).not.toContain('index.ts');
});

test('listChannels excludes test files', () => {
  const channels = listChannels();
  expect(channels).not.toContain('slack.test.ts');
});

test('listChannels includes known channels', () => {
  const channels = listChannels();
  expect(channels).toContain('slack.ts');
  expect(channels).toContain('telegram.ts');
  expect(channels).toContain('whatsapp.ts');
  expect(channels).toContain('mock.ts');
});
