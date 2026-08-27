import { createInterface } from 'readline/promises';

export { checkbox, confirm, input, select, rawlist, password } from '@inquirer/prompts';

// 'Paste the mcp json snippet (end with an empty line)
export async function multiline(text: string): Promise<string> {
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
