# PLAN.md - Marvin Project Plan

Status legend: `[x]` done · `[~]` partial · `[ ]` open

## Phase 0 — Quick wins
- [ ] **Retry LLM loop on failure** — retry the entire `sendChat` on failure (currently the error path at `agent.ts:326-329` returns early without retrying).

## Phase 0.5 — Logger refactor (DONE)
- [x] **Single shared logger singleton** — every class (`Command`, `System`, `Tool`, `Channel`, `Model`, `Engine`, `Agent`, `Mcp`) exposes a public `logger` field bound to the default-exported singleton from `src/logger.ts`. Constructors no longer take a `logger: Logger` arg. Slack command capture + test capture use `setDefaultOutput()` swap-and-restore. `setDefaultOutput()` returns a no-arg `restore()` thunk. `npx tsc --noEmit` clean. AGENTS.md documents the architecture.

## Phase 1 — Quick fixes & low-risk hardening

- [x] **Usage / token monitoring on the loop** — `Reply.usage` is sent by every provider and accumulated by `Agent.sendChat` (`agent.ts:284`); `Result.usage` is returned to callers and rendered in Slack (`channels/slack.ts:183`).
- [x] **Global `--help` / `-h` flag** — handled in `src/marvin.ts:93-138` (routes to `help` command).
- [x] **Deepseek `tool_choice` bug** — `body.tool_choice = body.tools?.length ? 'auto' : 'none'` (`models/deepseek.ts:113`); tools are now actually sent.
- [ ] **Lmstudio provider conformance** — `src/models/lmstudio.ts` is broken: `prompt` undefined (`:48`), hardcoded `messages` array (`:46-51`), returns `Promise<any>` (`:8`), no `stop` / `finish` / `usage` fields in the returned object, maps `args` not `arguments` (`:61`). Rewrite to match the `Reply` contract like `models/openai.ts`.
- [x] **Docs drift resolved** — removed `MAX_OUTPUT_RETRIES` / `validateSchema` / `schemaToJsonSchema` / `outputTool` / `execDeliverable` / "structured deliverables" from AGENTS.md (they don't exist in `src/`); moved to Phase 7 "Maybe later".

## Phase 2 — Doom-loop prevention (core robustness)

- [ ] **"No tools → stop" enforcement** — after `Agent.sendChat`'s tool-execution loop (`agent.ts:294-310`), if the assistant produced content but no tool calls and the model still says `stop: false`, force `ended = true`. Currently the loop only stops on `reply.stop` or max-steps (loop at `agent.ts:275-311`).
- [ ] **`src/loopGuard.ts` — repeated identical tool-call detection** — hash `(tool, sorted-key args)`; trip at `DOOM_LOOP_MAX_REPEATS = 3`. A burst of identical calls in one turn counts as **one** repeat.
- [ ] **Ping-pong / alternation detection** — sliding window of last 6 tool calls; flag `A→B→A→B` / `A→B→C→A→B→C` with ≥2 repetitions (`DOOM_LOOP_WINDOW = 6`).
- [ ] **Tool-error escalation** — same tool failing with the same error ≥3× (`DOOM_LOOP_MAX_ERROR_REPEATS = 3`) → steer/stop; success resets the streak.
- [ ] **No-progress / identical-reply detection** — N identical consecutive assistant outputs (`DOOM_LOOP_MAX_IDENTICAL_REPLIES = 3`).
- [ ] **Steer-then-stop ladder in `sendChat`** — wire the guard in: first trip → steer (skip execution, push `{tool, error, guarded}` refusal, don't count toward steps); second strike → stop (`ender = true`, return last non-empty content). Guard after the `end_chat` check.
- [ ] **Constants** — add `DOOM_LOOP_*` to `constants.ts` + AGENTS.md.
- [ ] **Tests for the guard** — extend `serve.test.ts`: repeated identical tool call stops/stears; failing-tool escalation; identical replies; ping-pong; update the intentionally-changed count assertions.

## Phase 3 — (retired)
- [x] **Internal toolset exists** — `src/tools/` now ships list/read/edit/append/move/delete, grep, web_search/fetch/browse, get_date, memory, marvin_state/config, load_tools, end_chat. Future tool ideas live in Phase 11.

## Phase 4 — LLM-assisted authoring
- [ ] **LLM-assisted generation of `TASK.md` & `IDENTITY.md`** — NOT implemented. `commands/agents.ts:153` and `commands/tasks.ts` currently use plain `input()` for raw markdown.
- [ ] **LLM-assisted prompt gen** — NOT implemented.

## Phase 5 — Streaming & runtime polish
- [ ] **LLM response streaming** — `stream: false` everywhere today (`models/deepseek.ts:99`, `models/openai.ts:28`, `models/lmstudio.ts:22`); wire `stream: true` through `Reply`.
- [ ] **Move validations from runtime to load time** — fail fast on bad config/schema in `load()` instead of mid-loop (e.g. `models/deepseek.ts:133` only checks `response.ok` after fetch).

## Phase 6 — Interactive & packaging
- [ ] **Interactive chat loop (`/exit` `/quit` `/stop`) in `agents` chat** — TODO at `src/commands/agents.ts:50`; `execChat` (`:42-80`) exits after one prompt.
- [ ] **Compiled binary (`bun build --compile`)** — `bin/marvin.js` is a 3-line stub importing `Server` from `../src/marvin.js`, but `marvin.ts` does not export `Server`. Build will fail.

## Phase 7 — Maybe later (deferred, not planned)
- [ ] **Structured deliverables** — previously described in AGENTS.md but never implemented. If built: typed task schemas (`validateSchema`/`schemaToJsonSchema` in `helpers.ts`), a deliverable flow in `sendChat` (`outputTool`/`action`, schema validation with self-correction bounded by `MAX_OUTPUT_RETRIES`, auto-run action after capture), and `execDeliverable` in `engine.ts`.

## Phase 8 — Code audit: engine, slack, deepseek

### A. Bugs to resolve (blocking / correctness)

- [ ] **Failed task kills itself permanently** — `src/engine.ts:748-750`: `execTask` returns on `result.error` without re-scheduling `task.timeout`; the reschedule is at `engine.ts:778`, after the early return. After one AI/model error the task never runs again. Must reschedule (with backoff) on error.
- [ ] **Max-steps warning never fires** — `src/agent.ts:311` loops `while (!ended && steps < DEFAULT_MAX_STEPS - 1)`, so `steps` can only reach `DEFAULT_MAX_STEPS - 1`. Then `agent.ts:314` checks `if (steps >= DEFAULT_MAX_STEPS)` — unreachable. Off-by-one in the loop or the check.
- [ ] **`dropChannel` not awaited** — `src/engine.ts:562`: `this.channels[id].drop()` is async and called without `await`; compare to `dropChannels` at `engine.ts:544-555` which awaits inside try/catch.
- [x] **DeepSeek `name: 'Human'` on every role** — gone: `src/models/deepseek.ts:85-97` no longer sends `name` at all. No action needed.
- [x] **Slack token validation without extra session** — `src/channels/slack.ts:86` validates via `auth.test()` before `socketClient.start()` (`:110`); no standalone `checkPrereqs`/`apps.connections.open` leak remains.

### B. Gaps in the flow (behavioral)

- [ ] **No conversation continuity in Slack (top-level messages / DMs)** — `src/channels/slack.ts:251` (`onMessage`) builds `chatId = slack-${event.channel}-${thread}` where `thread = event.thread_ts || event.ts || event.event_ts` (`:233`); without `thread_ts` it falls through to the message ts → every mention/DM is a brand-new chat (zero memory). Use a stable per-channel id when there is no `thread_ts` (e.g. `slack-${event.channel}-main`).
- [ ] **Tasks are stateless** — `src/engine.ts:744`: `const chatId = undefined` (TODO at `:743`). Decide + implement persistent task chats. `Task` interface in `types.ts:182` has no `persistent` field.
- [ ] **No per-chat concurrency lock** — two rapid Slack messages run concurrent `sendChat` calls on the same cached `chat` and interleave `chat.messages`. Add a per-chat mutex/queue in `Agent.sendChat` (`src/agent.ts:260`).
- [x] **External connectors removed** — external service connector feature removed per user request. `Agent.sendChat`/`makeChat` and `Engine.execTask` no longer handle external connectors; only MCP and internal tools remain.
- [ ] **Task overlap / missed tick** — `execTask` runs asynchronously from `setTimeout`; when execution exceeds `task.schedule` the next tick overlaps (and the error path in Phase 8A kills it permanently). Add a `task.running` flag to skip an in-flight tick.
- [ ] **Slack channel routing depends on id-vs-name mismatch** — `findAgent` (`src/channels/slack.ts:379-399`) compares `agent.channels['slack'] === event.channel` (an id from `event.channel`) against the config value; if `agents` stored a channel *name* (from `listGroups`), every message falls through to the orchestrator. Normalize to ids at config-write time or resolve names via `conversations.list` (`slack.ts:126-149`).
- [ ] **No idempotency on Slack events** — acked-but-timed-out socket events are re-delivered and processed twice (duplicate AI runs/replies). `onSocketMessage` is at `slack.ts:309-319`.

### C. Missing mandatory features (production-readiness)

- [ ] **Fetch timeout + retry in all providers** — `src/models/deepseek.ts:124` and `src/models/openai.ts:40` fetch has no `AbortSignal.timeout` (a hung request blocks the whole task loop forever); `helpers.ts` has no retry helper yet. Add timeout and retry/backoff on 429/5xx/network for deepseek/openai/anthropic/lmstudio.
- [ ] **DeepSeek param gating per model** — `src/models/deepseek.ts:100` always sends `thinking`, `:109` gates `reasoning_effort` on `chat.thinking` only. Verify compatibility with `deepseek-chat` vs `deepseek-reasoner`. Handle `reasoning_content` (TODO at `:169`; the property is parsed at `:18` but never used).
- [~] **Usage/cost surfaced to callers** — `Agent.sendChat` (`agent.ts:274,319`) accumulates into `chat.usage` and returns `Result.usage`, rendered in Slack's footer (`slack.ts:183`). Still missing: persist to the chat file usefully, aggregate per-agent/per-task totals, surface cost estimate.
- [ ] **`loadTools` uses literal `.replace('.ts','')`** — `src/engine.ts:204` is the only remaining literal `.replace('.ts', '')`; harmless but redundant. Single-line fix: drop the no-op `replace` and use the bare name from the list.
- [ ] **Slack `runCommand` imports with `.ts`** — `src/channels/slack.ts:341` `import(`../commands/${name}.ts`)` will break in a compiled binary; use `.js` like the rest of the codebase.
- [x] **Unify `onMention`/`onDirectMessage`** — merged into a single `onMessage` handler (`src/channels/slack.ts:232-270`); `app_mention` and DM `message` events (via `onSocketMessage`) both route through it. Tests updated.

---

## Phase 9 — Observability & cost control (good-to-have)
- [ ] **Per-agent/per-task usage totals** — aggregate `chat.usage` beyond the single-chat footer into a queryable total (log line or `marvin_state` field).
- [ ] **Token budgets + warnings** — `maxTokens`-style cap per agent/task; warn/steer when a run exceeds budget instead of failing silently.
- [ ] **`stats` command** — `marvin stats` (and `/marvin stats` in Slack): token totals, run counts, error counts from `logs/`.

## Phase 10 — Channel UX polish (good-to-have)
- [ ] **Slack message splitting** — chunk long LLM replies to fit Slack block limits instead of one giant `postMessage`.
- [ ] **Slack slash-command allowlist** — make `SLASH_BLOCKED_COMMANDS` (`slack.ts:13`) configurable instead of hardcoded.
- [ ] **Telegram/WhatsApp parity** — bring `telegram.ts` / `whatsapp.ts` to the same continuity/idempotency/routing standard as Slack once Phase 8B lands.

## Phase 11 — Safety & extensibility (good-to-have)
- [ ] **Per-agent tool allowlist** — `Config.agents[].tools` is declared (`types.ts:43`) but nothing enforces it in `makeChat`/`execTool`; wire it so agents only see/call their tools.
- [ ] **Destructive-tool confirmation** — gate `delete_file`/`move_file`/`edit_file` behind an explicit confirm step for scheduled tasks.
- [ ] **Secret redaction in logs** — `deepseek.ts:118` and `openai.ts` dump full request bodies to `logs/`; strip `Authorization`/api keys before persisting.
- [ ] **Concrete tool backlog** — candidates only, no commitment: `shell` (gated), `http_post`, `cron_parse`, `summarize_file`.

## Phase 12 — Packaging & ops (good-to-have)
- [ ] **Working compiled binary** — fix `bin/marvin.js` export, switch dynamic `import(... .ts)` (`marvin.ts:153`, `slack.ts:341`) to `.js`, verify `bun build --compile`.
- [ ] **Docker + systemd** — minimal `Dockerfile` and a working `marvin.service` install/verify flow.
- [ ] **Health endpoint** — `/health` on the `api` system (uptime, task counts, last error per task).

---

## Verification

After any change, run:

```bash
npx tsc --noEmit
bun test
```

(Last known-good state: 321/321 tests pass, `tsc` clean.)
