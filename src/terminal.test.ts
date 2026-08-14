import { test, expect } from 'bun:test';
import { select, multiselect } from './terminal.js';

test('select non-TTY fallback picks a single option by number', async () => {
  const ask = async () => '2';
  const result = await select('pick one', [{ label: 'a', value: 'A' }, { label: 'b', value: 'B' }], ask);

  expect(result).toBe('B');
});

test('select non-TTY fallback defaults to the first option on empty input', async () => {
  const ask = async () => '';
  const result = await select('pick one', [{ label: 'a', value: 'A' }, { label: 'b', value: 'B' }], ask);

  expect(result).toBe('A');
});

test('select non-TTY fallback ignores out-of-range numbers', async () => {
  const ask = async () => '99';
  const result = await select('pick one', [{ label: 'a', value: 'A' }], ask);

  expect(result).toBe('A');
});

test('multiselect non-TTY fallback picks multiple options by comma-separated numbers', async () => {
  const ask = async () => '1,3';
  const result = await multiselect('pick some', [{ label: 'a', value: 'A' }, { label: 'b', value: 'B' }, { label: 'c', value: 'C' }], ask);

  expect(result).toEqual(['A', 'C']);
});

test('multiselect non-TTY fallback selects all on empty input', async () => {
  const ask = async () => '';
  const result = await multiselect('pick some', [{ label: 'a', value: 'A' }, { label: 'b', value: 'B' }], ask);

  expect(result).toEqual(['A', 'B']);
});

test('multiselect non-TTY fallback returns an empty selection', async () => {
  const ask = async () => '0';
  const result = await multiselect('pick some', [{ label: 'a', value: 'A' }], ask);

  expect(result).toEqual([]);
});
