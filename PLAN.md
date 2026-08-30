# PLAN.md - Marvin Project Plan

Status legend: `[x]` done · `[~]` partial · `[ ]` open

## Phase 0 — Quick wins
- [ ] **Retry LLM loop on failure** — retry the entire `sendChat` on failure (currently the error path returns early without retrying).

## Phase 0.5 — Logger refactor (DONE)
- [x] **Single shared logger singleton** — every class (`Command`, `System`, `Tool`, `Channel`, `Integration`, `Model`, `Engine`, `Agent`, `Mcp`) exposes a public `logger` field bound to the default-exported singleton from `src/logger.ts`. Constructors no longer take a `logger: Logger` arg. Slack command capture + test capture use `setDefaultOutput()` swap-and-restore. `setDefaultOutput()` returns a no-arg `restore()` thunk. 381/381 tests pass; `npx tsc --noEmit` clean. AGENTS.md documents the architecture.

## Phase 1 — Quick fixes & low-risk hardening

- [x] **Usage / token monitoring on the loop** — `Reply.usage` is sent by every provider and accumulated by `Agent.sendChat` (`agent.ts:270`); `Result.tokens` is returned to callers and rendered in Slack (`channels/slack.ts:184`).
- [x] **Global `--help` / `-h` flag** — handled in `src/marvin.ts:104` (routes to `help` command).
- [x] **Deepseek `tool_choice` bug** — `body.tool_choice = body.tools?.length ? 'auto' : 'none'` (`models/deepseek.ts:113`); tools are now actually sent.
- [ ] **Lmstudio provider conformance** — `src/models/lmstudio.ts` is broken: `prompt` undefined (`models/lmstudio.ts:47`), maps `args` not `arguments` (`:60`), hardcoded `messages` array (`:45-50`), no `stop` / `finish` fields in the returned object, returns `Promise<any>`. Rewrite to match the `Reply` contract like `models/deepseek.ts`.
- [ ] **Global model result type** — only `lmstudio` returns `Promise<any>` (`models/lmstudio.ts:7`); make it return `Promise<Reply>` as part of the lmstudio fix.
- [x] **Docs drift resolved** — removed `MAX_OUTPUT_RETRIES` / `validateSchema` / `schemaToJsonSchema` / `outputTool` / `execDeliverable` / "structured deliverables" from AGENTS.md (they don't exist in `src/`); moved to Phase 7 "Maybe later".

## Phase 2 — Doom-loop prevention (core robustness)

- [ ] **"No tools → stop" enforcement** — after `Agent.sendChat`'s tool-execution loop (`agent.ts:280-299`), if the assistant produced content but no tool calls and the model still says `stop: false`, force `ended = true`. Currently the loop only stops on `reply.stop` or max-steps (loop at `agent.ts:262-300`).
- [ ] **`src/loopGuard.ts` — repeated identical tool-call detection** — hash `(tool, sorted-key args)`; trip at `DOOM_LOOP_MAX_REPEATS = 3`. A burst of identical calls in one turn counts as **one** repeat.
- [ ] **Ping-pong / alternation detection** — sliding window of last 6 tool calls; flag `A→B→A→B` / `A→B→C→A→B→C` with ≥2 repetitions (`DOOM_LOOP_WINDOW = 6`).
- [ ] **Tool-error escalation** — same tool failing with the same error ≥3× (`DOOM_LOOP_MAX_ERROR_REPEATS = 3`) → steer/stop; success resets the streak.
- [ ] **No-progress / identical-reply detection** — N identical consecutive assistant outputs (`DOOM_LOOP_MAX_IDENTICAL_REPLIES = 3`).
- [ ] **Steer-then-stop ladder in `sendChat`** — wire the guard in: first trip → steer (skip execution, push `{tool, error, guarded}` refusal, don't count toward steps); second strike → stop (`ender = true`, return last non-empty content). Guard after the `end_chat` check.
- [ ] **Constants** — add `DOOM_LOOP_*` to `constants.ts` + AGENTS.md.
- [ ] **Tests for the guard** — extend `serve.test.ts`: repeated identical tool call stops/stears; failing-tool escalation; identical replies; ping-pong; update the intentionally-changed count assertions.

## Phase 3 — More internal tools
- [ ] **More internal tools** — not implemented.

## Phase 4 — LLM-assisted authoring
- [ ] **LLM-assisted generation of `TASK.md` & `IDENTITY.md`** — NOT implemented. `commands/tasks.ts:120` and `commands/agents.ts:152` currently use plain `input()` for raw markdown.
- [ ] **LLM-assisted prompt gen** — NOT implemented.

## Phase 5 — Streaming & runtime polish
- [ ] **LLM response streaming** — `stream: false` everywhere today (`models/deepseek.ts:99`, `models/lmstudio.ts:21`); wire `stream: true` through `Reply`.
- [ ] **Move validations from runtime to load time** — fail fast on bad config/schema in `load()` instead of mid-loop (e.g. `models/deepseek.ts:135` only checks `response.ok` after fetch).

## Phase 6 — Interactive & packaging
- [~] **Interactive chat loop (`/exit` `/quit` `/stop`) in `agents` chat** — TODO at `src/commands/agents.ts:49`; only the TODO exists; `execChat` exits after one prompt.
- [~] **Compiled binary (`bun build --compile`)** — `bin/marvin.js` is a 3-line stub (`import { Server } from '../src/marvin.js';`) but `marvin.ts` does not export `Server`. Build will fail.

## Phase 7 — Maybe later (deferred, not planned)
- [ ] **Structured deliverables** — previously described in AGENTS.md but never implemented. If built: typed task schemas (`validateSchema`/`schemaToJsonSchema` in `helpers.ts`), a deliverable flow in `sendChat` (`outputTool`/`integration`/`action`, schema validation with self-correction bounded by `MAX_OUTPUT_RETRIES`, auto-run integration after capture), and `execDeliverable` in `engine.ts`.

## Phase 8 — Code audit: engine, slack, deepseek

### A. Bugs to resolve (blocking / correctness)

- [ ] **Failed task kills itself permanently** — `src/engine.ts:811-814`: `execTask` returns on `result.error` without re-scheduling `task.timeout`; the reschedule is at `engine.ts:841`, after the early return. After one AI/model error the task never runs again. Must reschedule (with backoff) on error.
- [ ] **Max-steps warning never fires** — `src/agent.ts:300` loops `while (!ended && steps < DEFAULT_MAX_STEPS - 1)`, so `steps` can only reach `DEFAULT_MAX_STEPS - 1`. Then `agent.ts:303` checks `if (steps >= DEFAULT_MAX_STEPS)` — unreachable. Off-by-one in the loop or the check.
- [ ] **`dropChannel` not awaited** — `src/engine.ts:615`: `this.channels[id].drop()` is async and called without `await`; compare to `dropChannels` at `engine.ts:597-608` which awaits inside try/catch.
- [ ] **DeepSeek forces `name: 'Human'` on every role** — `src/models/deepseek.ts:84-97` adds `name: 'Human'` to every message including system/assistant/tool. OpenAI-compatible endpoints reject tool messages that carry a `name`. Apply `name` only to `role: 'user'` (DeepSeek requires it there).
- [~] **`checkPrereqs` leaks a socket-mode session** — `apps.connections.open` is invoked by `SocketModeClient.start()` (called at `src/channels/slack.ts:111`). The connection leak is buried in the SDK and can't be fixed without bypassing `SocketModeClient`. Consider using `apps.connections.open` directly (Authorization-only) for token validation, then `start()` once for the real session.

### B. Gaps in the flow (behavioral)

- [ ] **No conversation continuity in Slack (top-level messages / DMs)** — `src/channels/slack.ts:250` (`onMessage`) builds `chatId = slack-${event.channel}-${thread}` where `thread = event.thread_ts || event.ts || event.event_ts` (`:233`); without `thread_ts` it falls through to the message ts → every mention/DM is a brand-new chat (zero memory). Use a stable per-channel id when there is no `thread_ts` (e.g. `slack-${event.channel}-main`).
- [ ] **Tasks are stateless** — `src/engine.ts:801`: `const chatId = undefined` (TODO at `:800`). Decide + implement persistent task chats. `Task` interface in `types.ts:262` has no `persistent` field.
- [ ] **No per-chat concurrency lock** — two rapid Slack messages run concurrent `sendChat` calls on the same cached `chat` and interleave `chat.messages`. Add a per-chat mutex/queue in `Agent.sendChat` (`src/agent.ts:247`).
- [ ] **Interactive chats cannot use per-action integration tools** — `Agent.sendChat` calls `loadChat` → `makeChat` (`agent.ts:252`), which does NOT call `loadIntegrationTools`. Only `Engine.execTask` (`engine.ts:803-807`) merges integration tools. Meanwhile `makeChat` (`agent.ts:78-105`) seeds the system prompt with ALL `engine.integrations` (or config fallback) regardless of agent/task linkage. Scope the integrations block per agent/task and expose linked actions as tools.
- [ ] **Task overlap / missed tick** — `execTask` runs asynchronously from `setTimeout`; when execution exceeds `task.schedule` the next tick overlaps (and the error path in Phase 8A kills it permanently). Add a `task.running` flag to skip an in-flight tick.
- [ ] **Slack channel routing depends on id-vs-name mismatch** — `findAgent` (`src/channels/slack.ts:425-445`) compares `agent.channels['slack'] === event.channel` (an id from `event.channel`) against the config value; if `agents` stored a channel *name* (from `listGroups`), every message falls through to the orchestrator. Normalize to ids at config-write time or resolve names via `conversations.list` (`slack.ts:127-150`).
- [ ] **No idempotency on Slack events** — acked-but-timed-out socket events are re-delivered and processed twice (duplicate AI runs/replies). `onSocketMessage` is at `slack.ts:347-357`.

### C. Missing mandatory features (production-readiness)

- [ ] **Fetch timeout + retry in all providers** — `src/models/deepseek.ts:125` fetch has no `AbortSignal.timeout` (a hung request blocks the whole task loop forever); `helpers.ts` has no retry helper yet. Add timeout and retry/backoff on 429/5xx/network for deepseek/openai/anthropic/lmstudio.
- [ ] **DeepSeek param gating per model** — `src/models/deepseek.ts:100` always sends `thinking`, `:113` `tool_choice`, no `response_format` (good). Verify compatibility with `deepseek-chat` vs `deepseek-reasoner`. Handle `reasoning_content` (TODO at `:170`; the property is parsed at `:17` but never used).
- [~] **Usage/cost surfaced to callers** — `Chat.usage` (`types.ts:298-301`) is declared but never assigned. `Agent.sendChat` (`agent.ts:270`) accumulates into a local `tokens` and returns `Result.tokens`; nothing is persisted to the chat or surfaced to the user beyond Slack's footer. Aggregate into the chat cache.
- [ ] **`loadTools` uses literal `.replace('.ts','')`** — `src/engine.ts:214` is the only remaining literal `.replace('.ts', '')`; harmless but redundant (the list already strips the extension). Single-line fix: drop the no-op `replace` and use the bare name from the list.
- [ ] **Slack `runCommand` imports with `.ts`** — `src/channels/slack.ts:387` `import(\`../commands/${name}.ts\`)` will break in a compiled binary; use `.js` like the rest of the codebase.
- [x] **Unify `onMention`/`onDirectMessage`** — merged into a single `onMessage` handler (`src/channels/slack.ts:232-269`); `app_mention` and DM `message` events (via `onSocketMessage`) both route through it. Tests updated.

---

## Verification

After any change, run:

```bash
npx tsc --noEmit
bun test
```

(Last known-good state: 381/381 tests pass, `tsc` clean.)
