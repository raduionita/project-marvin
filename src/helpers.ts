import { existsSync, lstatSync, realpathSync } from 'fs';
import { basename, dirname, resolve, sep } from 'path';
import { readdirSync } from 'fs';

export function tryJsonParse<T>(str: string): T {
  try {
    return JSON.parse(str) as T;
  } catch (error) {
    console.warn('[tryJsonParse]', `"${str}"`, error);
    return {} as T;
  }
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function rand(min:number, max:number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getRootDir() {
  return import.meta.dirname.replace(/\/src.*/, '')
}

// Extract the natural-language string out of an LLM JSON output
// (e.g. {"output": "the answer"}). Falls back to the raw content unchanged
// when it is not a JSON object, so plain-text replies still pass through.
export function extractOutput(content: string): string {
  if (!content) return content;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }

  if (typeof parsed === 'string') return parsed;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return content;

  for (const key of ['output', 'text', 'answer', 'content', 'message']) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  return content;
}

// Resolve `target` to an absolute path inside the workspace `home` folder.
// Guards against escaping via `..`, absolute paths, and symlinks. Returns the
// canonical (symlink-free) absolute path, or `null` when the target is outside
// the workspace or is a symlink at the final path component.
export function resolveInsideHome(home: string, target: string): string | null {
  if (!target) return null;

  try {
    const homeReal = realpathSync(home);

    // absolute, normalized target (relative paths are resolved against home)
    const abs = resolve(home, target);

    // if the target exists (or is a broken symlink), inspect the final component
    try {
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) {
        // never follow symlinks at the target: they could point outside home
        return null;
      }
      const real = realpathSync(abs);
      return (real === homeReal || real.startsWith(homeReal + sep)) ? real : null;
    } catch (err) {
      if ((err as { code?: string })?.code !== 'ENOENT') {
        // exists but unreadable -> treat as invalid
        return null;
      }
    }

    // target does not exist: realpath the deepest existing ancestor, then
    // re-append the missing components
    const missing: string[] = [];
    let probe = abs;
    while (!existsSync(probe)) {
      const parent = dirname(probe);
      if (parent === probe) return null; // walked past the filesystem root
      missing.unshift(basename(probe));
      probe = parent;
    }

    const resolved = resolve(realpathSync(probe), ...missing);
    return (resolved === homeReal || resolved.startsWith(homeReal + sep)) ? resolved : null;
  } catch {
    return null;
  }
}

// #endregion
