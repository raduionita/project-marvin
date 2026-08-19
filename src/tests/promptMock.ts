import { mock } from 'bun:test';

// A set of mock prompt functions that consume a shared queue of scripted
// answers, mirroring @inquirer/prompts' return types so command tests can run
// without a TTY:
//   - input/password return the raw scripted string
//   - number parses the answer to an int (falling back to cfg.default)
//   - select/rawlist match the answer exactly by value/name, else interpret it
//     as a 1-based option index (the old numbered fallback behavior)
//   - expand matches the answer by key or by value/name
//   - checkbox interprets comma-separated 1-based indices; a blank answer
//     selects every option (used by the "all fields required" flows)
export function buildPromptMocks(getAnswers: () => string[]) {
  const next = () => getAnswers().shift() ?? '';

  const number = mock(async (cfg?: { default?: number }) => {
    const v = Number(next());
    return Number.isNaN(v) ? cfg?.default ?? undefined : v;
  });

  const select = mock(async (cfg?: { choices?: { name?: string; value: unknown }[]; default?: unknown }) => {
    const raw = next().trim();
    const choices = cfg?.choices ?? [];
    const exact = choices.find(c => c.value === raw || String(c.name) === raw);
    if (exact !== undefined) return exact.value;
    const nums = raw.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < choices.length);
    return nums.length ? choices[nums[0]!]!.value : (cfg?.default ?? choices[0]?.value);
  });

  const rawlist = mock(async (cfg?: { choices?: { name?: string; value: unknown }[]; default?: unknown }) => {
    const raw = next().trim();
    const choices = cfg?.choices ?? [];
    const exact = choices.find(c => c.value === raw || String(c.name) === raw);
    if (exact !== undefined) return exact.value;
    const nums = raw.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < choices.length);
    return nums.length ? choices[nums[0]!]!.value : (cfg?.default ?? choices[0]?.value);
  });

  const expand = mock(async (cfg?: { choices?: { key?: string; name?: string; value: unknown }[]; default?: unknown }) => {
    const raw = next().trim().toLowerCase();
    for (const c of cfg?.choices ?? []) {
      if (c.key === raw || String(c.value).toLowerCase() === raw || String(c.name).toLowerCase() === raw) return c.value;
    }
    if (cfg?.default !== undefined) {
      const def = (cfg.choices ?? []).find(c => c.key === String(cfg.default).toLowerCase() || c.value === cfg.default);
      if (def !== undefined) return def.value;
    }
    return cfg?.choices?.[0]?.value;
  });

  const checkbox = mock(async (cfg?: { choices?: { value: unknown }[] }) => {
    const raw = next();
    const choices = cfg?.choices ?? [];
    const nums = raw.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < choices.length);
    if (raw.trim() === '') return choices.map(c => c.value);
    return nums.map(i => choices[i]!.value);
  });

  return {
    input: mock(async () => next()),
    password: mock(async () => next()),
    confirm: mock(async (cfg?: { default?: boolean }) => {
      const raw = next().toLowerCase();
      return raw === '' ? cfg?.default ?? false : ['y', 'yes', '1', 'true'].includes(raw);
    }),
    number,
    select,
    rawlist,
    expand,
    checkbox,
  };
}