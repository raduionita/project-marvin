# PLAN.md - Marvin Project Plan

Status legend: `[x]` done · `[~]` partial · `[ ]` open

## Phase 0 — Quick wins
- [ ] **Retry LLM loop on failure** — retry the entire loop on failure: if chat loops fails, retry the whole thing.

## Phase 0.5 — Logger refactor (DONE)
- [x] **Single shared logger singleton** — every class (`Command`, `System`, `Tool`, `Channel`, `Integration`, `Model`, `Engine`, `Agent`, `Mcp`) exposes a public `logger` field bound to the default-exported singleton from `src/logger.ts`. Constructors no longer take a `logger: Logger` arg; subclass ctors call `super(engine[, config])`. Slack command capture + test capture now use `setDefaultOutput()` swap-and-restore. `setDefaultOutput()` returns a no-arg `restore()` thunk. `npx tsc --noEmit` clean, 381/381 tests pass. AGENTS.md documents the architecture.

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

## Phase 8 — Code audit: engine, slack, deepseek (from source review)

### A. Bugs to resolve (blocking / correctness)
- [ ] **Discarded `task.input` file read** — `engine.ts:494` `readFileSync(input, 'utf8').trim()` result is never assigned; a task whose `input` is a file path sends the *path* to the LLM, not the file content. Should be `input = readFileSync(...)`.
- [ ] **Custom tools never load** — `tools/index.ts:31` `listCustomTools` returns names **without** `.ts`, but `engine.ts:235` imports `join(cdir, file)` (no extension) and `engine.ts:231` `file.replace('.ts','')` is a no-op. `~/.marvin/tools/*.ts` are silently skipped. Import `join(cdir, \`${name}.ts\`)`.
- [ ] **Failed task kills itself permanently** — `engine.ts:773-776`: `execTask` returns on `result.error` without re-scheduling `task.timeout`; after one AI/model error the task never runs again. Must reschedule (with backoff) on error.
- [ ] **Max-steps warning never fires** — `engine.ts:1047` loop exits when `steps == maxSteps - 1`, so `if (steps >= maxSteps)` (`:1050`) is unreachable. Off-by-one in the loop or the check.
- [ ] **Orphaned `tool_calls` in history** — `engine.ts:1014` appends the assistant message *before* executing tools; when `reply.stop` (`:1020`) breaks the turn, tool results are never appended. OpenAI-compatible APIs reject a follow-up request with unmatched `tool_call_id`s. Execute tools / flush results before the `stop` break, or keep pairs intact.
- [ ] **`dropChannel` not awaited** — `engine.ts:596` `this.channels[id].drop()` is async and called without `await` (also lacks the try/catch of `dropChannels`).
- [ ] **DeepSeek forces `name: 'Human'` on every role** — `deepseek.ts:15` adds `name: 'Human'` to system/assistant/tool messages too; tool messages with `name` are rejected by OpenAI-compatible endpoints. Apply `name` only to `role: 'user'` (DeepSeek requires it there).
- [ ] **Double `ack()` on Slack DMs** — `slack.ts:356-363` `onSocketMessage` acks, then delegates to `onDirectMessage` which acks again. Single-ack in the router.
- [ ] **`checkPrereqs` leaks a socket-mode session** — `slack.ts:160` calls `apps.connections.open` to validate the app token, which opens a real WSS session that is never closed (and may consume the single socket-mode connection the app gets).

### B. Gaps in the flow (behavioral)
- [ ] **No conversation continuity in Slack (top-level messages / DMs)** — `slack.ts:292` and `:335` build `chatId = slack-${channel}-${thread}` with `thread = event.thread_ts || event.ts`; without a thread this is the message ts, so every mention/DM starts a brand-new chat (zero memory). Use a stable per-channel id when there is no `thread_ts` (e.g. `slack-${channel}-main`).
- [ ] **Tasks are stateless** — `engine.ts:761-762` `chatId = undefined` (TODO; also `Task.persistent` TODO at `types.ts:187`): tasks never cache/persist chats, losing cross-run context despite `makeChat`/`saveChat` supporting it. Decide + implement persistent task chats.
- [ ] **No per-chat concurrency lock** — two rapid Slack messages run concurrent `sendChat` calls on the same cached `chat` (engine.ts:983) and interleave `chat.messages`. Add a per-chat mutex/queue in `sendChat`.
- [ ] **`trimChat` breaks tool_calls ↔ tool-result pairing** — `engine.ts:961-973` trims by message count and can drop a `tool` result while keeping its `assistant` tool_calls message (or vice versa) → next request invalid. Trim must drop whole call/result groups.
- [ ] **Interactive chats cannot use per-action integration tools** — only tasks merge integration tools (`engine.ts:768`); `newChat` TODO `loadIntegrationTools` (`:932`) and `chat.tools` (`:940`) expose default tools only. Meanwhile the system prompt leaks *all* integrations into *every* chat (`:887-912`), even unlinked ones. Scope the integrations block per agent/task and expose linked actions as tools.
- [ ] **Task overlap / missed tick** — `execTask` runs asynchronously from `setTimeout`; when execution exceeds `task.schedule` the next tick overlaps (or the error path above kills it). Add a `task.running` flag to skip an in-flight tick.
- [ ] **Slack channel routing depends on id-vs-name mismatch** — `findAgent` (`slack.ts:489`) compares `agent.channels['slack'] === event.channel` (an id) against the config value; if `agents` stored a channel *name* (from `listGroups`), every message falls through to the orchestrator. Normalize to ids at config-write time or resolve names via `conversations.list`.
- [ ] **No idempotency on Slack events** — acked-but-timed-out socket events are re-delivered and processed twice (duplicate AI runs/replies).
- [ ] **`scanProject` failures don't abort `load()`** — `engine.ts:56-66` continues loading even when `~/.marvin` is missing (fail-fast instead).

### C. Missing mandatory features (production-readiness)
- [ ] **Fetch timeout + retry in all providers** — `deepseek.ts:51` fetch has no `AbortSignal.timeout` (a hung request blocks the whole task loop forever); `helpers.ts:22` `withRetry` exists but is unused. Add timeout and retry/backoff on 429/5xx/network for deepseek/openai/anthropic/lmstudio.
- [ ] **DeepSeek param gating per model** — `deepseek.ts:28` always sends `thinking` and `:40` `response_format: json_object`; verify compatibility with `deepseek-chat` vs `deepseek-reasoner` (some combos 400). Handle `reasoning_content` (TODO `:93`).
- [ ] **Usage/cost surfaced to callers** — `Chat.usage` (`types.ts:261`) exists but `sendChat` never accumulates `Reply.usage`; nothing reports tokens/cost to the user or the logger. Aggregate into the returned result.
- [ ] **`loadSystems`/`loadTools` use literal `.replace('.ts','')`** — `engine.ts:179` and `:231`; align with the `/\.ts$/` regex used in the fixed indexes (consistency + name-collision safety).
- [ ] **Slack `runCommand` imports with `.ts`** — `slack.ts:407` `import(\`../commands/${name}.ts\`)` breaks in a compiled binary; use `.js` like the rest of the codebase.
- [ ] **Unify `onMention`/`onDirectMessage`** — `slack.ts:268-352` are near-identical (extract → findAgent → sendChat); one shared handler would avoid future drift.
