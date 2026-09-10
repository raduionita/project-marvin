# PLAN.md - Marvin Project Plan

Status legend: `[x]` done · `[~]` partial · `[ ]` open · `[-]` cancelled / superseded

## Phase 0 — Quick wins
- [ ] **Retry LLM provider requests on transient errors** — wire `withRetry` (from `src/helpers/index.ts`) into provider `fetch()` calls (`models/openai.ts`, `models/deepseek.ts`) with backoff on 429/5xx/network errors and `AbortSignal.timeout(60_000)`. *(Note: retrying the entire multi-turn `sendChat` loop was superseded to avoid re-executing non-idempotent tool side-effects).*

## Phase 0.5 — Logger refactor (DONE)
- [x] **Single shared logger singleton** — every class (`Command`, `System`, `Tool`, `Channel`, `Model`, `Engine`, `Agent`, `Mcp`) exposes a public `logger` field bound to the default-exported singleton from `src/logger.ts`. Constructors no longer take a `logger: Logger` arg. Slack command capture + test capture use `setDefaultOutput()` swap-and-restore. `setDefaultOutput()` returns a no-arg `restore()` thunk. `npx tsc --noEmit` clean. AGENTS.md documents the architecture.

## Phase 1 — Quick fixes & low-risk hardening

- [x] **Usage / token monitoring on the loop** — `Reply.usage` is sent by every provider and accumulated by `Agent.sendChat` (`agent.ts:240,285`); `Result.usage` is returned to callers and rendered in Slack (`channels/slack.ts:256`).
- [x] **Global `--help` / `-h` flag** — handled in `src/marvin.ts:93-138` (routes to `help` command).
- [x] **Deepseek `tool_choice` bug** — `body.tool_choice = body.tools?.length ? 'auto' : 'none'` (`models/deepseek.ts:113`); tools are now actually sent.
- [ ] **Unify OpenAI-compatible providers & deprecate `lmstudio.ts`** — make `OpenaiModel` (`models/openai.ts`) support a configurable `baseUrl`. This provides full, robust support for LM Studio, Ollama, LocalAI, vLLM, and OpenRouter without maintaining the broken standalone `models/lmstudio.ts`.
- [x] **Docs drift resolved** — removed `MAX_OUTPUT_RETRIES` / `validateSchema` / `schemaToJsonSchema` / `outputTool` / `execDeliverable` / "structured deliverables" from AGENTS.md (they don't exist in `src/`); moved to Phase 7 "Maybe later".

## Phase 2 — Doom-loop prevention (core robustness)

- [ ] **"No tools → stop" enforcement** — after `Agent.sendChat`'s tool-execution loop (`agent.ts:255-274`), if the assistant produced text content but no tool calls and the model still says `stop: false` (or undefined), force `ended = true`. Currently the loop only stops on `reply.stop` or max-steps (`agent.ts:277`).
- [ ] **`src/loopGuard.ts` — repeated identical tool-call detection** — hash `(tool, sorted-key args)`; trip at `DOOM_LOOP_MAX_REPEATS = 3`. A burst of identical calls in one turn counts as **one** repeat.
- [ ] **Ping-pong / alternation detection** — sliding window of last 6 tool calls; flag `A→B→A→B` / `A→B→C→A→B→C` with ≥2 repetitions (`DOOM_LOOP_WINDOW = 6`).
- [ ] **Tool-error escalation** — same tool failing with the same error ≥3× (`DOOM_LOOP_MAX_ERROR_REPEATS = 3`) → steer/stop; success resets the streak.
- [ ] **No-progress / identical-reply detection** — N identical consecutive assistant outputs (`DOOM_LOOP_MAX_IDENTICAL_REPLIES = 3`).
- [ ] **Steer-then-stop ladder in `sendChat`** — wire the guard in: first trip → steer (skip execution, push `{tool, error, guarded}` refusal, don't count toward steps); second strike → stop (`ended = true`, return last non-empty content). Guard after the `end_chat` check.
- [ ] **Constants** — add `DOOM_LOOP_*` to `constants.ts` + AGENTS.md.
- [ ] **Tests for the guard** — extend `serve.test.ts`: repeated identical tool call stops/steers; failing-tool escalation; identical replies; ping-pong; update assertions.

## Phase 3 — (retired)
- [x] **Internal toolset exists** — `src/tools/` ships list/read/edit/append/move/delete, grep, web_search/fetch/browse, get_date, memory, marvin_state/config, end_chat. The dynamic `load_tools` tool was retired in v0.9.26 in favor of static tool-group bindings.

## Phase 4 — LLM-assisted authoring (deferred / low-priority)
- [-] **LLM-assisted generation of `TASK.md` & `IDENTITY.md`** — Deferred. The current interactive `$EDITOR` / `@inquirer/editor` workflow in `tasks.ts` and `agents.ts` using sensible defaults from `constants.ts` is faster and more reliable than conversational prompt wizards.
- [-] **LLM-assisted prompt gen** — Deferred.

## Phase 5 — Streaming & runtime polish
- [ ] **LLM response streaming** — `stream: false` everywhere today (`models/deepseek.ts:99`, `models/openai.ts:28`); wire `stream: true` through `Reply` and support chunked rendering.
- [ ] **Move validations from runtime to load time** — fail fast on bad config/schema in `Engine.load()` instead of mid-loop (e.g. validate tool group names, API keys, and model availability).

## Phase 6 — Interactive & packaging
- [ ] **Interactive chat loop (`/exit` `/quit` `/stop`) in `agents` chat** — TODO at `src/commands/agents.ts:54`; `execChat` (`:46-84`) currently exits after one prompt.
- [ ] **Compiled binary (`bun build --compile`)** — fix `bin/marvin.js` (currently imports non-existent `Server`), update dynamic `import(... .ts)` (`slack.ts:347`) to resolve compiled paths, verify clean standalone build.

## Phase 7 — Structured deliverables (cancelled)
- [-] **Structured deliverables** — Cancelled. Replaced by native tool calling, MCP servers, and agent-level tool-group boundaries.

## Phase 8 — Code audit: engine, slack, deepseek

### A. Bugs to resolve (blocking / correctness)

- [x] **Failed task kills itself permanently** — resolved: `src/engine.ts:804` reschedules `task.timeout = setTimeout(this.execTask.bind(this), task.schedule, taskId)` on `result.error`.
- [x] **Max-steps warning never fires** — resolved: off-by-one fixed in `src/agent.ts:277-280` (`steps < constants.DEFAULT_MAX_STEPS` followed by `if (steps >= constants.DEFAULT_MAX_STEPS)`).
- [ ] **`dropChannel` not awaited** — `src/engine.ts:614`: `this.channels[id].drop()` is async and called without `await`; compare to `dropChannels` (`:596-607`) which awaits inside try/catch.
- [x] **DeepSeek `name: 'Human'` on every role** — gone: `src/models/deepseek.ts` no longer sends `name`.
- [x] **Slack token validation without extra session** — `src/channels/slack.ts:86` validates via `auth.test()` before `socketClient.start()`.

### B. Gaps in the flow (behavioral)

- [ ] **No conversation continuity in Slack (top-level messages / DMs)** — `src/channels/slack.ts:210,228`: `chatId = slack-${event.channel}-${thread}` where `thread = event.thread_ts || event.ts || event.event_ts`; without `thread_ts` it falls through to the message ts → every mention/DM is a brand-new chat (zero memory). Fall back to a stable per-channel ID when there is no `thread_ts` (e.g. `slack-${event.channel}-main` or `slack-dm-${event.user}`).
- [ ] **Tasks are stateless** — `src/engine.ts:798`: `const chatId = undefined` (TODO at `:797`). Provide configuration for persistent task chat history vs stateless ticks.
- [ ] **No per-chat concurrency lock** — two rapid Slack messages or API calls run concurrent `sendChat` calls on the same cached `chat` and interleave `chat.messages`. Add a per-chat async queue/mutex in `Agent.sendChat` (`src/agent.ts:226`).
- [x] **External connectors removed** — external service connector feature removed. MCP and internal tools remain.
- [ ] **In-flight task cancellation on `Engine.drop()`** — `execTask` uses sequential `setTimeout` so intervals do not drift, but `Engine.dropTasks()` cannot abort in-flight task executions. Add `AbortController` support to cancel running tasks on shutdown/reload.
- [ ] **Slack channel routing depends on id-vs-name mismatch** — `findAgent` (`src/channels/slack.ts:385-405`) compares `agent.channels['slack'] === event.channel` (an ID) against config; if an agent stored a channel *name* (from manual entry), messages fall through to orchestrator. Normalize to IDs or resolve names.
- [ ] **No idempotency on Slack events** — acked-but-timed-out socket events are re-delivered and processed twice. Track processed event IDs in `onSocketMessage` (`slack.ts:303-313`).

### C. Missing mandatory features (production-readiness)

- [ ] **Fetch timeout + retry in all providers** — add `AbortSignal.timeout(60_000)` and `withRetry` to `src/models/openai.ts:40` and `src/models/deepseek.ts:124`.
- [ ] **DeepSeek param gating per model** — `src/models/deepseek.ts:100` always sends `thinking`, `:108` gates `reasoning_effort` on `chat.thinking` only. Verify compatibility with `deepseek-chat` vs `deepseek-reasoner`. Handle `reasoning_content` (TODO at `:169`).
- [~] **Usage/cost surfaced to callers** — `Agent.sendChat` (`agent.ts:240,285`) accumulates into `chat.usage` and returns `Result.usage`, rendered in Slack footer (`slack.ts:256`). Still missing: aggregate per-agent/per-task totals and surface estimated cost.
- [ ] **`loadTools` uses literal `.replace('.ts','')`** — `src/engine.ts:209`: `listCustomTools` already returns extensionless names. Drop redundant `.replace()`.
- [ ] **Slack `runCommand` imports with `.ts`** — `src/channels/slack.ts:347` `import(`../commands/${name}.ts`)` will break in a compiled binary; use dynamic resolution or `.js`.
- [x] **Unify `onMention`/`onDirectMessage`** — merged into a single `onMessage` handler (`src/channels/slack.ts:209-264`).

---

## Phase 9 — Observability & cost control (good-to-have)
- [ ] **Per-agent/per-task usage totals** — aggregate `chat.usage` beyond the single-chat footer into a queryable total (log line or `marvin_state` field).
- [ ] **Token budgets + warnings** — `maxTokens`-style cap per agent/task; warn/steer when a run exceeds budget instead of failing silently.
- [ ] **Task failure alerting** — optionally send an alert to configured agent channels when a scheduled task fails repeatedly.
- [ ] **`stats` command** — `marvin stats` (and `/marvin stats` in Slack): token totals, run counts, error counts from `logs/`.

## Phase 10 — Channel UX polish (good-to-have)
- [ ] **Slack message splitting** — chunk long LLM replies to fit Slack block limits (3,000 chars per markdown block) instead of a single block.
- [ ] **Slack slash-command allowlist** — make `SLASH_BLOCKED_COMMANDS` (`slack.ts:15`) configurable instead of hardcoded.
- [ ] **Telegram/WhatsApp parity** — bring `telegram.ts` / `whatsapp.ts` to the same continuity/idempotency/routing standard as Slack once Phase 8B lands.

## Phase 11 — Safety & extensibility (good-to-have)
- [x] **Per-agent tool allowlist** — implemented in v0.9.26: `Config.agents[].tools` stores tool groups, `Engine.pickTools()` binds allowed tools to `Agent.tools`, `Agent.makeChat()` exposes only allowed tools to LLM, and `marvin agents add/edit` prompts for tool groups.
- [ ] **Destructive-tool confirmation** — gate `delete_file`/`move_file`/`edit_file` behind an explicit confirm step for scheduled tasks.
- [x] **Secret redaction in logs** — raw payload dumping to `logs/*.log` was disabled in `src/models/deepseek.ts`. Ensure debug loggers strip `Authorization` / API key headers across all providers.
- [ ] **Concrete tool backlog** — candidates only, no commitment: `shell` (gated), `http_post`, `cron_parse`, `summarize_file`.

## Phase 12 — Packaging & ops (good-to-have)
- [ ] **Working compiled binary** — fix `bin/marvin.js` export, switch dynamic `import(... .ts)` (`marvin.ts:153`, `slack.ts:347`) to `.js`, verify `bun build --compile`.
- [ ] **Docker + systemd** — minimal `Dockerfile` and a working `marvin.service` install/verify flow.
- [ ] **Health endpoint metrics** — enrich existing `/_health` in `src/systems/api.ts` with uptime, task counts, and last error per task.

---

## Verification

After any change, run:

```bash
npx tsc --noEmit
bun test
```

(Last known-good state: 354/354 tests pass, `tsc` clean.)
