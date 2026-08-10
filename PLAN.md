# PLAN.md - Marvin Project Plan

Status legend:
- `[x]` = **done** (implemented and in the codebase)
- `[~]` = **partial** (implemented but incomplete / does not fully match the intent)
- `[ ]` = **todo** (not implemented)

> Source of truth is the **code**. Any mismatch between the `.md` docs and the code is
> recorded in the [Discrepancies](#discrepancies--docs-vs-code) section below.

---

## Phase 0 - Architecture / Codebase Overview

Current reality (from code):

- Single entry point: `src/marvin.ts` (CLI dispatcher). There is no `client.ts` / `server.ts`.
- `src/engine.ts` is the core `Engine` class (config, lifecycle, AI loop, agent scheduling).
- `bin/marvin.js` exists but imports a named `Server` export that does not exist (stub).
- `install.sh` / `uninstall.sh` / `marvin.service` bootstrap & run on Linux/systemd.
- Tests live alongside sources: `*.test.ts`, plus `channel.mock.ts`.

### Recorded status
- [x] 1.1 CLI dispatcher & command registry (`src/marvin.ts`, `src/commands/index.ts`)
- [x] 1.2 Config loading (`marvin.json`, `.env` / `.env.local`) via `Engine.loadConfig`
- [x] 1.3 Engine lifecycle: `load` / `exec` / `drop` + state machine (`src/engine.ts`)
- [x] 1.4 Project scan / bootstrap (`Engine.scanProject`)
- [x] 1.5 Resource loaders: systems, tools, channels, models, agents (`Engine.loadX`)

---

## Phase 2 - AI Loop (core agent loop)

- [x] 2.1 `Engine.execChat` AI loop: model call -> tool execution -> repeat (`engine.ts`)
- [x] 2.2 Sessionless task loop `Engine.execTask` + reschedule (`setTimeout`)
- [x] 2.3 Orchestrator loop `Engine.execOrchestrator`
- [x] 2.4 `--dry` flag (DRY feature) — `Engine.isDry`, all commands honor it
- [x] 2.5 Internal stop tool `end_chat` (`src/tools/end_chat.ts`, `END_CHAT_NAME`)
- [~] 2.6 Chat persistence / cache — `saveChat`/`findChat` exist; **task chats are stateless** (TODO in code: chatId = undefined)
- [~] 2.7 Usage / token monitoring on the loop — partial (only `DeepseekModel`/`fallback` report usage; no Conversation/session aggregation)

### Models
- [x] Providers present: `deepseek.ts`, `openai.ts`, `anthropic.ts`, `lmstudio.ts`, `fallback.ts`
- [~] `Reply` result type is provider-agnostic **only in `deepseek.ts` and `fallback.ts`**.
- [ ] `openai.ts` / `anthropic.ts` / `lmstudio.ts` still return `Promise<any>` and do not conform to `Reply`
  (missing `stop`, mismatched usage keys, `args` vs `arguments`, hardcoded LM Studio schema/messages).

---

## Phase 3 - Tools & Systems

### Internal tools (`src/tools/`)
- [x] 3.1 `get_date` (`get_date.ts`)
- [x] 3.2 `web_search` (`web_search.ts`) — DuckDuckGo scraped via browser
- [x] 3.3 `web_browse` (`web_browse.ts`) — browser page -> text
- [x] 3.4 `end_chat` (`end_chat.ts`) — AI loop stop tool
- [x] 3.5 `read_file` (`read_file.ts`) — read a file from disk, **guarded to `~/.marvin`** (`resolveInsideHome`)
- [x] 3.6 `edit_file` (`edit_file.ts`) — create/overwrite a file or replace a snippet, **same `~/.marvin` guard**
  (rejects `..` escapes, absolute paths outside home, and symlinks pointing outside)
- [x] 3.7 Config/state tools (`marvin_state.ts`, `marvin_config.ts`)
  - `marvin_state` — read the runtime state (agents, tasks, models, channels, settings; optional `area` filter)
  - `marvin_config` — read marvin.json (whole config or dotted `key`) and `set` a dotted key (JSON/string),
    persists inside `~/.marvin` via `resolveInsideHome`, keeps `engine.config` in sync

### Systems (`src/systems/`)
- [x] 3.6 `api` (`api.ts`) — HTTP server: `_health`, `reload`, `status`, `chat` (basic Bearer auth)
- [x] 3.7 `browser` (`browser.ts`) — puppeteer / chromium, resource-blocking interception
- [x] 3.8 `watch` (`watch.ts`) — file watcher on `marvin.json` -> auto `execReload`

---

## Phase 4 - Channels

- [x] 4.1 Slack (`slack.ts`) — socket-mode, `app_mention` + `message` (DMs routed via `channel_type: "im"`), `sendMessage`
- [x] 4.2 Slack **threads** reply (`thread_ts` + persistent `slack-<channel>-<thread>` chatId)
- [x] 4.3 Channel coverage — Slack implemented & tested; `telegram.ts` / `whatsapp.ts` are **stubs**
  (`sendMessage` is a `console.debug` no-op, `listGroups` throws). Server->channel tested via `slack.test.ts`.
- [x] 4.4 **End-to-end ingress tested (Slack -> Marvin -> LLM -> Slack)** — `src/channels/slack.test.ts`
  runs the real handlers (`onMention`, `onDirectMessage`) with mocked Slack SocketMode/Web clients and a
  mocked LLM. Covers: app_mention round-trip, DM round-trip (via the real `message` event +
  `channel_type: "im"` dispatch), tool-call loop (`get_date` + `end_chat`), thread replies, empty-text
  placeholder, LLM-failure fallback, and bot self-messages being ignored (no infinite loop). All external
  calls (Slack SDK, LLM API) are mocked; no real network or browser is used.
  Note: the real `@slack/socket-mode` emits DMs as `message` (not `message.im`), so `slack.ts` listens on
  `message` and filters `channel_type`. Events that are not DMs (or are the bot's own) are still `ack`ed.
  Chat replies keep `format: "json"` in the AI loop; `helpers.extractOutput` pulls the string (`.output`)
  out of the LLM's JSON before posting to Slack (`slack.ts`, `engine.ts execTask`).

---

## Phase 5 - Sessions & Agents

- [x] 5.1 Orchestrator / default agent "marvin" with fallback (`Engine.loadAgents`) + default `status` task
- [x] 5.2 Per-agent `IDENTITY.md` + orchestrator `MARVIN.md` loading
- [ ] 5.3 `Session` object wrapping `Chat` — NOT implemented (TODO)
- [ ] 5.4 execTask wrapped in a Conversation (monitor API calls / tokens) — NOT implemented

---

## Phase 6 - Client commands (`src/commands/`)

Implemented commands: `agents, channels, debug, disable, enable, help, install, models, reload, serve, status, tools, update, version`.

- [x] 6.1 `channels` — `list` / `add` / `bind` / `chat` (only interactive + positional args)
- [x] 6.2 `models` — `list` / `add` (only interactive)
- [x] 6.3 `agents` — `chat` (only interactive, single-shot prompt)
- [x] 6.4 `tool` — `list` / call a tool directly
- [x] 6.5 `install` — bootstrap workspace (`~/.marvin`, agents/, MARVIN.md, marvin.json)
- [x] 6.6 service mgmt: `enable` / `disable` / `status` / `update` / `reload` / `version`
- [ ] 6.7 `marvin agents add` / `marvin tasks add` / `marvin tools add` (creation) — NOT implemented
- [ ] 6.9 LLM-assisted generation of `TASK.md` & `IDENTITY.md` — NOT implemented
- [ ] 6.10 global `--help` / `-h` flag — NOT implemented (only per-command `help` subcommands)

---

## Phase 7 - Installer & Deployment

- [x] 7.1 `install.sh` — downloads release tarball, installs Bun, deps, wrapper, workspace
- [x] 7.2 `uninstall.sh`
- [x] 7.3 `marvin.service` (systemd user unit)
- [~] 7.4 Compiled binary (`bun build --compile`) — script exists; `bin/marvin.js` is a broken stub (imports a non-existent `Server` export)

---

## Phase 8 - Backlog

- [ ] 8.1 LLM response **streaming**
- [ ] 8.2 Move validations from runtime to **load time**
- [ ] 8.3 Interactive chat loop (`/exit` `/quit` `/stop`) in `agents` chat — TODO in code

---

## Discrepancies

### AGENTS.md vs code
1. **Entry points** — AGENTS.md: "Both `client.ts` and `server.ts` are self-contained entry points."
   Code: a single `src/marvin.ts`; no `client.ts` / `server.ts`.
2. **Tool filenames (camelCase vs snake_case)** — AGENTS.md lists `getDate.ts`, `webBrowse.ts`,
   `webSearch.ts`; actual files are `get_date.ts`, `web_browse.ts`, `web_search.ts` (+ `end_chat.ts`).
3. **Commands list** — AGENTS.md lists `load.ts`, `drop.ts`, `chat.ts`. Code has none of those.
   The real set is `agents, channels, debug, disable, enable, help, install, models, reload, serve,
   status, tool, update, version`. Install/bootstrap is `install.ts`; chat is a `agents` subcommand.
4. **Channels list** — AGENTS.md lists only `slack.ts`. Code also has `telegram.ts`, `whatsapp.ts`,
   plus test/mock files.
5. **Models list** — AGENTS.md omits `fallback.ts`.
6. **Systems** — AGENTS.md says `browser.ts` + `http.ts`. Code: `browser.ts` + `api.ts` (the HTTP
   server, not `http.ts`) + `watch.ts`.
7. **Undocumented files** — `src/engine.ts` (the core engine) is not in AGENTS.md's structure.
8. **Workspace user tools** — AGENTS.md: `~/.marvin/tools/` user-defined tools (mirrors `src/tools/`).
   Code only loads tools from `src/tools/`; `~/.marvin/tools` is never scanned.
9. **"Marvin channels" meaning** — AGENTS.md says channels are "communication channels between the
   client and the server", distinguishing them from Slack channels. In code, `Channel` is clearly a
   user-facing output (Slack/Telegram/WhatsApp). The AGENTS.md wording is misleading vs the code.

### README.md vs repo
1. **`marvin load`** — README: "Bootstrap the system" via `marvin load`. No `load` command; use `marvin install`.
2. **`marvin reload` via HTTP** — README: "Reload server config via HTTP". The `reload` command uses
   `systemctl --user reload` (HTTP `/reload` endpooint exists in `api.ts` but is not used by the CLI).
3. **Installer steps** — README: installer "sets up a systemd service" and "starts it", creates env file
   `~/.config/marvin/env`. `install.sh` does **not** install/start a systemd service and creates **no** env file.
4. **Bun version** — README: "Bun v0.5.0 or higher". Bun is far beyond 0.5 now; stale.
5. **"Client mode interacts with the running server"** — README: `marvin` (no args) = client. Code: default
   command is `help`. The HTTP client mode is only partial (health/status via `/status`, `/_health`).

### TODO.md vs repo (resolved items now implemented)
- [x] **`end_chat` stop tool** (was: "NEED internal stop tool") — done (`src/tools/end_chat.ts`).
- [x] **orchestrator/default agent "marvin"** - done (`Engine.loadAgents`).
- [x] **`--dry` flag / DRY** — done (`Engine.isDry`).
- [x] **Slack thread replies** — done (`thread_ts`).
- [~] **Model result type** — `Reply` defined, but only `deepseek`/`fallback` conform; others are `any`.
- [ ] **Session wrapper / Conversation monitoring** — not implemented (see Phase 5).
- [ ] **`marvin add agent|task|tool`** — not implemented (Phase 6).
- [ ] **More internal tools** — not implemented (Phase 3).
- [ ] **LLM-assisted prompt gen** — not implemented (Phase 6).
- [ ] **Streaming** — not implemented (Phase 8).

### Work-in-progress (git)
Uncommitted changes: `src/channels/slack.ts`, `src/commands/channels.ts` (modified), `src/channels/example.ts` (deleted).
This session also adds: `src/tools/read_file.ts` + `read_file.test.ts`, `src/tools/edit_file.ts` +
`edit_file.test.ts`, `src/tools/marvin_state.ts` + `marvin_state.test.ts`, `src/tools/marvin_config.ts` +
`marvin_config.test.ts`, `resolveInsideHome` guard in `helpers.ts`, `extractOutput` (LLM JSON -> string)
in `helpers.ts` + `helpers.test.ts`, `src/engine.ts` (null-safe assistant reply + awaited `load()` +
dry-mode chat save + outbound JSON extraction in `execTask`), `src/channels/slack.ts` (real `message`
event dispatch for DMs, bot-self filter, empty-DM guard, JSON output extraction), rewritten
`src/channels/slack.test.ts` (E2E ingress + dispatcher + JSON extraction), and fixes to stale tests
in `serve.test.ts`, `tools/index.test.ts`, `get_date.test.ts`, `channels/index.test.ts`, `channel.mock.ts`.
The full suite (118 tests) and `npx tsc --noEmit` are green. TODO.md was removed (user decision).
