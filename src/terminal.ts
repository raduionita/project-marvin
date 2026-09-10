import { createInterface } from 'readline/promises';
import { execSync } from 'child_process';

export { checkbox, confirm, input, select, rawlist, password, number } from '@inquirer/prompts';
export { default as editor } from '@inquirer/editor';

// sync shell runner: returns stdout when encoding is set, else ''
export function sh(cmd: string, opts?: { cwd?: string; stdio?: 'inherit' | 'pipe'; encoding?: 'utf8' }): string {
  if (opts?.encoding) {
    return execSync(cmd, { ...opts, encoding: 'utf8' }) as unknown as string;
  }
  execSync(cmd, { cwd: opts?.cwd, stdio: opts?.stdio || 'inherit' });
  return '';
}

// 'Paste the mcp json snippet (end with an empty line)
export async function textbox(text: string): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  return await new Promise<string>(resolve => {
    process.stdout.write(`${text}\n`);
    rl.on('line', line => {
      if (!line.trim()) {
        rl.close();
        return;
      }
      lines.push(line);
    });
    rl.on('close', () => resolve(lines.join('\n')));
  });
}
