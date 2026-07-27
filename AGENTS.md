# AGENTS.md - Marvin Project

You are a Principal TypeScript Engineer working on **Marvin** - a multi-agent AI assistant with a client-server architecture. The server is a persistent background process that manages agents executing autonomous scheduled tasks. The client is a standalone app communicating with the server via HTTP API.

**Tech stack:** Node.js + TypeScript

---

## Repository Structure

- `src/`
  - `channels/`             # where all channels are being loaded from
    - `index.ts`            # lists channels
    - `slack.ts`            # channel implementation
  - `models/`               # where all models are being loaded from
    - `index.ts`            # lists models
    - `lmstudio.ts`         # local lmstudio model-provider implementation
    - `openai.ts`           # openai model-provider implementation
    - `anthropic.ts`        # anthropic model-provider implementation
    - `deepseek.ts`         # deepseek model-provider implementation
  - `tools/`                # internal tools folder
    - `index.ts`            # lists tools
    - `getDate.ts`          # tool implementation
    - `webBrowse.ts`        # tool implementation
    - `webSearch.ts`        # tool implementation
  - `commands/`             # command line interface
    - `help.ts`             # help command
    - `load.ts`             # load command
    - `drop.ts`             # drop command
    - `serve.ts`            # serve command, runs the agents
    - `update.ts`           # update command
    - `version.ts`          # version command
    - `status.ts`           # status command
    - `chat.ts`             # chat command, chat with the LLM
    - `channels.ts`         # channels command
    - `reload.ts`           # reload command
  - `systems/`              # system implementations
    - `browser.ts`          # browser system
    - `http.ts`             # http system
  - `constants.ts`          # project wide constants
  - `types.ts`              # types and interfaces
  - `helpers.ts`            # helper functions
  - `marvin.ts`             # entry point, runs client or server
  - `declare.d.ts`          # declares modules (i.e. bun:test)
  - `**/*.test.ts`          # test files
  - `**/*.mock.ts`          # mock files

---

## Workspace Structure

Loaded from `~/.marvin/` at runtime (created on first run):

- `~/.marvin/`
  - `marvin.json`       # config: settings, channels, models, agents
  - `MARVIN.md`         # assistant identity file
  - `agents/`
    - `agent-1/`
      - `IDENTITY.md`   # agent identity file
      - `tasks/`
        - `TASK-1.md`   # task prompt - seeds the AI loop
  - `tools/`            # user-defined tools (mirrors src/tools/)
    - `index.ts`
    - `doSomething.ts`

---

## Core Concepts

- `Model` - `MyModel extends Model`; provider logic + LLM config
- `Chat` - conversation history (messages, thinking, …)
- `Message` - single entry in the chat history
- `Channel` - user-facing output: Slack, Discord, Telegram, email, …
- `Tool` - executable action: `webSearch`, `webBrowse`, `getDate`, …
- `Agent` - runs scheduled tasks; communicates via configured channels
- `Task` - periodic prompt or `.md` file that starts the AI loop
- `execTask` - engine: runs the AI loop, then reschedules itself

Common types live in `types.ts`. Both `client.ts` and `server.ts` are self-contained entry points for their respective modes.
Do not confuse Marvin channels with Slack channels, they are different things. In Marvin they are communication channels between the client and the server.

---

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
- No new dependencies unless necessary; explain any non-obvious tradeoffs
- All changes must stay compatible with the current codebase
- Avoid using `as any` or `as unknown`

## Task Backlog
`TODO.md` file contains project's for pending taks, code that needs to be implemented, and other notes.
Completed items in `TODO.md` should be removed, ask before removing it.

---

## Goal

Build an AI assistant similar to **OpenClaw**.
