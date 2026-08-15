# PLAN.md - Marvin Project Plan

Status legend: `[x]` done · `[~]` partial · `[ ]` open

## Phase 0 — TODOs
- [ ] **Retry LLM loop on failure** — retry the entire loop on failure: if chat loops fails, retry the whole thing.

## Phase 1 — Quick fixes & low-risk hardening (easiest)

- [x] **Usage / token monitoring on the loop** — all providers report `usage` (deepseek/openai/anthropic/lmstudio/fallback); only surface it to the user.
- [x] **Global `--help` / `-h` flag** — handled in `src/marvin.ts:104` (routes to `help` command).
- [x] **Deepseek `tool_choice` bug** — `body.tool_choice = body.tools?.length ? 'auto' : 'none'` (`deepseek.ts:42`); tools are now actually sent.
- [ ] **Lmstudio provider conformance** — `lmstudio.ts` is broken: references undefined `prompt` (:48), maps `args` not `arguments` (:61), omits `stop` and `finish`, returns `Promise<any>`. Rewrite to match the `Reply` contract like `deepseek.ts`.
- [ ] **Global model result type** — only `lmstudio` returns `Promise<any>`; make all providers return `Reply` (part of the lmstudio fix).
- [x] **Docs drift resolved** — removed `MAX_OUTPUT_RETRIES` / `validateSchema` / `schemaToJsonSchema` / `outputTool` / `execDeliverable` / "structured deliverables" from AGENTS.md (they don't exist in `src/`); moved to Phase 7 "Maybe later".

## Phase 2 — Doom-loop prevention (core robustness)

- [ ] **"No tools → stop" enforcement** — uncomment the block at `engine.ts:1016` so a reply with content but no tool calls breaks the loop regardless of `reply.stop` (kills the never-stopping mock case).
- [ ] **`src/loopGuard.ts` — repeated identical tool-call detection** — hash `(tool, sorted-key args)`; trip at `DOOM_LOOP_MAX_REPEATS = 3`. A burst of identical calls in one turn counts as **one** repeat.
- [ ] **Ping-pong / alternation detection** — sliding window of last 6 tool calls; flag `A→B→A→B` / `A→B→C→A→B→C` with ≥2 repetitions (`DOOM_LOOP_WINDOW = 6`).
- [ ] **Tool-error escalation** — same tool failing with the same error ≥3× (`DOOM_LOOP_MAX_ERROR_REPEATS = 3`) → steer/stop; success resets the streak.
- [ ] **No-progress / identical-reply detection** — N identical consecutive assistant outputs (`DOOM_LOOP_MAX_IDENTICAL_REPLIES = 3`).
- [ ] **Steer-then-stop ladder in `sendChat`** — wire the guard in: first trip → steer (skip execution, push `{tool, error, guarded}` refusal, don't count toward steps); second strike → stop (`ender = true`, return last non-empty content). Guard after the `end_chat` check.
- [ ] **Constants** — add `DOOM_LOOP_*` to `constants.ts` + AGENTS.md.
- [ ] **Tests for the guard** — extend `serve.test.ts`: repeated identical tool call stops/stears; failing-tool escalation; identical replies; ping-pong; update the intentionally-changed count assertions (`callCount === 5`, `steps === 4`, etc.).

## Phase 3 — More internal tools

- [ ] **More internal tools** — not implemented (was Phase 3 in the old plan).

## Phase 4 — LLM-assisted authoring

- [ ] **LLM-assisted generation of `TASK.md` & `IDENTITY.md`** — NOT implemented.
- [ ] **LLM-assisted prompt gen** — NOT implemented (was Phase 6).

## Phase 5 — Streaming & runtime polish

- [ ] **LLM response streaming** — `stream: false` everywhere today; wire `stream: true` through `Reply`.
- [ ] **Move validations from runtime to load time** — fail fast on bad config/schema in `load()` instead of mid-loop.

## Phase 6 — Interactive & packaging (hardest)

- [~] **Interactive chat loop (`/exit` `/quit` `/stop`) in `agents` chat** — TODO at `agents.ts:43`; only the TODO exists.
- [~] **Compiled binary (`bun build --compile`)** — `bin/marvin.js` is a broken stub (`import { Server }` from a module that exports none); script exists, build broken.

## Phase 7 — Maybe later (deferred, not planned)

- [ ] **Structured deliverables** — previously described in AGENTS.md but never implemented; moved here when docs drift was fixed. If built, it would need: typed task schemas (`validateSchema`/`schemaToJsonSchema` in `helpers.ts`), a deliverable flow in `sendChat` (`outputTool`/`integration`/`action`, schema validation with self-correction bounded by `MAX_OUTPUT_RETRIES`, auto-run integration after capture), and `execDeliverable` in `engine.ts`.
