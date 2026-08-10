import { test, expect } from 'bun:test';
import { extractOutput } from './helpers.js';

test('extractOutput pulls the output field from JSON', () => {
  expect(extractOutput('{"output": "hello world"}')).toBe('hello world');
});

test('extractOutput returns plain text unchanged when not JSON', () => {
  expect(extractOutput('plain text reply')).toBe('plain text reply');
});

test('extractOutput decodes a JSON string value', () => {
  expect(extractOutput('"quoted value"')).toBe('quoted value');
});

test('extractOutput falls back to common answer keys', () => {
  expect(extractOutput('{"answer": "42"}')).toBe('42');
  expect(extractOutput('{"message": "hi"}')).toBe('hi');
});

test('extractOutput returns content unchanged when JSON has no string field', () => {
  expect(extractOutput('{"status": "ok"}')).toBe('{"status": "ok"}');
});

test('extractOutput handles empty content', () => {
  expect(extractOutput('')).toBe('');
  expect(extractOutput('{}')).toBe('{}');
});