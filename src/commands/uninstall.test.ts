import { test, expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import Engine from '../engine.js';
import UninstallCommand from './uninstall.js';

// guard bypass: tmpdirs live outside $HOME, so deletion tests stub the guard
class TestCommand extends UninstallCommand {
  override isSafeToRemove(p: string): boolean {
    return p.length > 0 && p !== '/';
  }
}

function buildCommand(args: string[] = []): TestCommand {
  const engine = new Engine();
  engine.work = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  engine.root = mkdtempSync(join(tmpdir(), 'marvin-test-'));
  return new TestCommand(engine, args);
}

test('parseFlags reads --keep-config, --yes and --force', () => {
  expect(buildCommand([]).parseFlags()).toEqual({ keepConfig: false, assumeYes: false, force: false });
  expect(buildCommand(['--keep-config']).parseFlags().keepConfig).toBe(true);
  expect(buildCommand(['--yes']).parseFlags().assumeYes).toBe(true);
  expect(buildCommand(['-y']).parseFlags().assumeYes).toBe(true);
  expect(buildCommand(['--force']).parseFlags()).toEqual({ keepConfig: false, assumeYes: true, force: true });
});

test('isSafeToRemove only allows paths inside $HOME', () => {
  const engine = new Engine();
  const cmd = new UninstallCommand(engine, []);
  expect(cmd.isSafeToRemove('')).toBe(false);
  expect(cmd.isSafeToRemove('/')).toBe(false);
  expect(cmd.isSafeToRemove(homedir())).toBe(false);
  expect(cmd.isSafeToRemove('/tmp/marvin-evil')).toBe(false);
  expect(cmd.isSafeToRemove(join(homedir(), '.local', 'share', 'marvin-test-predicate'))).toBe(true);
});

test('removePath deletes a dir and reports missing paths as done', () => {
  const cmd = buildCommand();
  const dir = join(cmd.engine.work, 'subdir');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'f.txt'), 'x');

  expect(cmd.removePath(dir, 'test dir')).toBe(true);
  expect(existsSync(dir)).toBe(false);
  expect(cmd.removePath(join(cmd.engine.work, 'nope'), 'test dir')).toBe(true);
  expect(cmd.removePath('/', 'test dir')).toBe(false);

  rmSync(cmd.engine.work, { recursive: true, force: true });
  rmSync(cmd.engine.root, { recursive: true, force: true });
});

test('removeProject skips git checkouts unless forced', async () => {
  const cmd = buildCommand();
  mkdirSync(join(cmd.engine.root, '.git'));

  await cmd.removeProject(cmd.engine.root, false);
  expect(existsSync(cmd.engine.root)).toBe(true);

  await cmd.removeProject(cmd.engine.root, true);
  expect(existsSync(cmd.engine.root)).toBe(false);

  rmSync(cmd.engine.work, { recursive: true, force: true });
});
