import { createInterface } from 'readline/promises';

export { checkbox, confirm, input, select, rawlist, password, number } from '@inquirer/prompts';
export { default as editor } from '@inquirer/editor';

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
