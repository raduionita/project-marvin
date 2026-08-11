import { test, expect } from 'bun:test';
import { extractOutput, cleanContent } from './helpers.js';

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

test('cleanContent returns valid JSON unchanged', () => {
  expect(cleanContent('{"output": "hello world"}')).toBe('{"output": "hello world"}');
});

test('cleanContent keeps only the leading JSON object, dropping trailing markup', () => {
  const content = '{"output": "hello world"}<tool_calls>\n<invoke name="end_chat">\n<parameter name="answer">done</parameter>\n</invoke>\n</tool_calls>';
  expect(cleanContent(content)).toBe('{"output": "hello world"}');
});

test('cleanContent handles braces inside the JSON string value', () => {
  const content = '{"output": "use {this} and }that}"}<tool_calls>...</tool_calls>';
  expect(cleanContent(content)).toBe('{"output": "use {this} and }that}"}');
});

test('cleanContent returns plain text unchanged when no JSON value is present', () => {
  expect(cleanContent('plain text <tool_calls>...</tool_calls>')).toBe('plain text <tool_calls>...</tool_calls>');
});