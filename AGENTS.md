# AGENTS.md - Marvin Project

**Marvin** - Multi-purpose AI assistant. Node.js + TypeScript, run with `bun`.

## Goal
A general-purpose AI assistant daemon: agents run scheduled tasks, each task seeds an AI loop that produces a result, and the engine delivers that result to user-facing channels and external integrations. Claude/opencode agents should be able to read the codebase and implement commands, tools, models, integrations, channels, skills, and systems without prior knowledge of the project.

---

## Repository structure
- `src/marvin.ts` - entry point / CLI bootstrap. Parses flags, loads `.env`/`.env.local` (dotenv), reads `marvin.json`, then dynamically imports `./commands/<cmd>.ts` (the module must export a `default` class extending `Command`). Daemon commands (`deamon = true`, e.g. `serve`) keep the process alive.
- `src/engine.ts` - the core `Engine` class: config + workspace (`~/.marvin`), the AI loop (`sendChat`), agent/task scheduling (`execMonitor`/`execSweep`/`execInput`), tool dispatch (`execTool`), chat cache (chatId -> Chat), and system prompt assembly.
- `src/types.ts` - all core interfaces: `Command`, `Config`, `Channel`, `Tool`, `Model`, `Agent`, `System`, `Task`, `Message`, `Reply`, `Chat`, `Integration`, `Skill`, `ToolMeta`, `Schema`. Almost every class is an `abstract class` with a `meta` (name/description) and `load()`/`drop()` lifecycle. The base classes `Command`, `System`, `Tool`, `Channel`, `Integration`, `Model` all expose a public `logger` field that points to the shared singleton from `./logger.js` — they do NOT take a `logger` constructor argument. Constructor signatures: `Command(engine, args, deamon=false)`, `System(engine)`, `Tool(engine)`, `Channel(engine)`, `Integration(engine, config)`, `Model(engine, config)`.
- `src/commands/` - one file per CLI command (`add`, `enable`, `reload`, `serve`, ...), each exporting a `default` class extending `Command` with `exec()`.
- `src/tools/` - built-in executable actions (`web_search`, `get_date`, `read_file`, `memory`, `call_integration`, ...). `end_chat` is special: calling it stops the AI loop.
- `src/models/` - one file per provider (`openai`, `anthropic`, `deepseek`, `lmstudio`, `fallback`), each exporting a `default` class extending `Model` implementing `sendChat(chat): Promise<Reply>`. Tools are passed as `chat.tools`. **`sendChat` MUST return valid `reply.message.content`**: if `chat.format === 'json'` a JSON string (e.g. `'{"output":"an article"}'`); if `'text'` clean trimmed text. No model junk (e.g. leaked DSML tags) in the content.
- `src/channels/` - user-facing output channels (`slack`, `telegram`, `whatsapp`): `sendMessage(message)`, plus `load()`/`drop()`.
- `src/integrations/` - external service integrations (`wordpress`) with named actions. Integrations can be linked to tasks (`task.integrations` in marvin.json): each linked action becomes a per-action tool named `<integrationId>__<action>` (built by `loadIntegrationTools` in `src/integrations/index.ts`, merged into `chat.tools` by `execTask`, routed by `execTool`). Standalone calls go through `call_integration`/`find_integration`.
- `src/systems/` - internal infrastructure (`api` HTTP server, `browser`, `watch` file watcher) with `load()`/`drop()`.
- `src/skills/` - markdown skill docs (header + body, e.g. `SKILLS-CREATE.md`, `TOOLS-CREATE.md`, `WORDPRESS-CONNECT.md`); parsed and injected into the system prompt. User skills in `~/.marvin/skills/` override.
- `src/constants.ts` - project-wide constants (`DEFAULT_MAX_STEPS`, `DEFAULT_CONFIG`).
- `src/helpers.ts` - pure helpers: `tryJsonParse`, `extractOutput`, `cleanContent`, `markdownToHtml`, `safeJoin`, ...
- `src/logger.ts`, `src/memory.ts` - logging and memory storage (see below). Interactive prompts use `@inquirer/prompts` directly in commands (mock it in tests via `src/tests.ts`).

## Workspace (`~/.marvin/`, created on first run)
- `marvin.json` - the whole configuration: settings, channels, models, agents, tasks, tools, skills, integrations.
- `MARVIN.md` - assistant identity.
- `marvin.service` - systemd unit file.
- `agents/<agent>/IDENTITY.md` - agent identities.
- `tasks/<task>/TASK.md` - task prompts (TASK.md seeds the AI loop).
- `memories/<agent-id>/<key>.md` - persistent memory scoped per agent, written/read by the `memory` tool and summarized into the system prompt.
- `skills/*.md`, `tools/*.ts` - user-defined skills and tools (snake_case) that mirror the built-in folders.

## Core concepts and flows
- **Registration pattern**: every `channels/`, `models/`, `tools/`, `integrations/`, `systems/`, `skills/`, `commands/` folder has an `index.ts` that lists its files by scanning the directory (skipping `.test.ts`, `.mock.ts`, `.d.ts`). To add a component: create the file, export `default`, done - no registry edits.
- **The AI loop** (`Agent.sendChat` in `src/agent.ts`): keep chat history bounded (`packChat`) -> `model.execChat(chat)` -> persist assistant reply -> execute each tool call, pushing results back as `role: 'tool'` messages -> repeat until `end_chat`, max steps, or truncation (`reply.finish === 'length'`).
- **Scheduling**: tasks run on schedules (`execMonitor`/`execSweep`) and each run reschedules itself; `serve` is the daemon that keeps this alive.
- **Testing**: `bun test` (files `*.test.ts`, mocks in `*.mock.ts`) and `npx tsc --noEmit` for type checks.

## Conventions
- Use ESM `import ... from './x.js'`; TypeScript `strict` - avoid `as any`/`as unknown` (non-null assertions are fine).
- `logger.info` messages must NOT be prefixed with `[ClassName.method]`; `debug`/`warn`/`error` must. Log level via `MARVIN_LOG_LEVEL` or `--logLevel`; `setLoggerMode` toggles prefixes.
- No new dependencies unless necessary; explain non-obvious tradeoffs.

## Logger (`src/logger.ts`)

A single shared **singleton** is the source of truth — every component imports it directly. The base classes in `src/types.ts` (`Command`, `System`, `Tool`, `Channel`, `Integration`, `Model`) plus the long-lived `Engine`/`Agent`/`Mcp` classes all expose a public `logger` field bound to that singleton; **no class receives a `Logger` through its constructor**. Subclasses call `super(engine[, config])` — never pass a logger.

```ts
// every component file starts the same way:
import logger from './logger.js';
```

The singleton (and the `Logger` class behind it) is stateful and **shared by every caller** via two module-level switches:

- `setLoggerMode({ prefix?, stripTags? })` — flips `[LEVEL]` prefix and `[ClassName.method]` tag stripping for **all** Logger instances. Used by `marvin serve` to switch to daemon output (prefixed, tags kept) and by tests to assert on raw lines. Console mode = `prefix: false, stripTags: true`; daemon mode = `prefix: true, stripTags: false`.
- `setDefaultOutput(fn)` — replaces the sink for **all** Logger instances that have no per-instance `output` override. Returns a no-arg `restore()` thunk that puts the previous sink back. Used by:
  - `SlackChannel.runCommand` — captures command output per invocation and replies in Slack without leaking to the global console.
  - `src/tests.ts: captureLogger()` — returns `{ lines, restore }` so a test can assert on `lines.join('\n')` and call `restore()` (typically at the end of the test) to put the console sink back. **Always restore**, even on failure — `try/finally` or end-of-test `restore()`.

A `Logger` instance with an `output` override (passed in its constructor opts) ignores `setDefaultOutput` — that's the escape hatch for the legacy per-instance capture pattern. New code should prefer the singleton + `setDefaultOutput` swap.

## AI Workflow (claude, opencode, etc.)
1. Read and inspect the relevant source files
2. Create a plan split into small, independent, focused steps/edits (edit = **smallest correct change**)
3. Execute plan STEP-BY-STEP, each step MUST pass tests and have NO errors
    1. Apply it the update
    2. RECHECK the file for errors (run `npx tsc --noEmit`)
    3. Validate the result (run `bun test`)
4. Summarize what changed and why

## Rules
- Prefer small, focused edits - avoid unrelated cleanup
- Preserve existing style, conventions, and formatting unless asked
- All changes must stay compatible with the current codebase
- Follow the registration pattern above when adding new components
- Only commit when explicitly asked

