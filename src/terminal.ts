import { promises, emitKeypressEvents } from 'readline';

import type { Option } from './types.js';

function isTTY(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}

type KeyInfo = { name?: string; ctrl?: boolean };

// plain text prompt: reads a single trimmed line from the terminal
export async function ask(question: string): Promise<string> {
  const pli = promises.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await pli.question(question)).trim();
  pli.close();
  return answer;
}

// interactive radio/checkbox selector using raw-mode keypresses. arrow keys to
// move, space to toggle (multi), enter to confirm, ctrl+c to cancel.
function keypressSelect<T>(prompt: string, options: Option<T>[], multi: boolean): Promise<T | T[] | undefined> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  let index = 0;
  const selected = new Set<number>();

  let resolvePromise: (v: T | T[] | undefined) => void = () => {};
  const done = new Promise<T | T[] | undefined>((resolve) => { resolvePromise = resolve; });

  const draw = () => {
    for (let i = 0; i < options.length; i++) {
      stdout.write('\x1b[2K\x1b[0G'); // clear line, cursor to col 0
      const marker = multi
        ? (selected.has(i) ? '[x] ' : '[ ] ')
        : (i === index ? '> ' : '  ');
      stdout.write(`${marker}${options[i]?.label ?? ''}\n`);
    }
  };

  const finish = (value: T | T[] | undefined) => {
    stdin.setRawMode(!!wasRaw);
    stdin.pause();
    stdin.off('keypress', onKey);
    stdout.write(`\x1b[${options.length}A`); // move up above the list
    for (let i = 0; i < options.length; i++) {
      stdout.write('\x1b[2K\x1b[0G\n');
    }
    stdout.write(`\x1b[${options.length}A`); // back up, ready for caller output
    resolvePromise(value);
  };

  const onKey = (_str: string, key: KeyInfo) => {
    if (key.name === 'up') {
      index = (index - 1 + options.length) % options.length;
      draw();
    } else if (key.name === 'down') {
      index = (index + 1) % options.length;
      draw();
    } else if (key.name === 'space' && multi) {
      if (selected.has(index)) selected.delete(index); else selected.add(index);
      draw();
    } else if (key.name === 'return' || key.name === 'enter') {
      if (multi) {
        finish(Array.from(selected).sort((a, b) => a - b).map(i => options[i]!.value));
      } else {
        finish(options[index]!.value);
      }
    } else if (key.name === 'c' && key.ctrl) {
      finish(undefined);
    }
  };

  stdin.on('keypress', onKey);

  stdout.write(`${prompt}\n`);
  draw();

  return done;
}

// numbered-list fallback for non-TTY input (pipes, tests). uses the provided
// ask function or the default terminal prompt.
async function fallback<T>(prompt: string, options: Option<T>[], multi: boolean, askFn?: (q: string) => Promise<string>): Promise<T | T[] | undefined> {
  const askQ = askFn || ask;

  const list = options.map((o, i) => `  ${i + 1}) ${o.label}`).join('\n');
  const hint = multi ? 'comma-separated numbers' : 'number';
  const raw = await askQ(`${prompt}\n${list}\nEnter ${hint} (enter = all): `);
  const nums = raw.split(',').map(s => s.trim()).filter(Boolean).map(s => parseInt(s, 10) - 1).filter(i => i >= 0 && i < options.length);

  if (multi) {
    // empty input selects everything; an explicit (invalid) list selects nothing
    if (raw.trim() === '') return options.map(o => o.value);
    return nums.map(i => options[i]!.value);
  }
  if (nums.length === 0) return options[0]?.value;
  return options[nums[0]!]!.value;
}

// radio select: arrow keys + enter (or numbered input on non-TTY). a scripted
// ask function always takes the numbered fallback so tests never block on input.
export async function select<T>(prompt: string, options: Option<T>[], ask?: (q: string) => Promise<string>): Promise<T | undefined> {
  if (ask || !isTTY(process.stdin)) {
    return await fallback<T>(prompt, options, false, ask) as T | undefined;
  }
  return await keypressSelect<T>(prompt, options, false) as T | undefined;
}

// checkbox select: arrow keys + space to toggle, enter to confirm. a scripted
// ask function always takes the numbered fallback (comma-separated).
export async function multiselect<T>(prompt: string, options: Option<T>[], ask?: (q: string) => Promise<string>): Promise<T[] | undefined> {
  if (ask || !isTTY(process.stdin)) {
    return await fallback<T>(prompt, options, true, ask) as T[] | undefined;
  }
  return await keypressSelect<T>(prompt, options, true) as T[] | undefined;
}
