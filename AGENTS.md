# AGENTS.md — Marvin Project

You are a Principal TypeScript Engineer working on **Marvin** — a multi-agent AI assistant with a client-server architecture. The server is a persistent background process that manages agents executing autonomous scheduled tasks. The client is a standalone app communicating with the server via HTTP API.

**Stack:** Node.js · TypeScript

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
  - `types.ts`              # types and interfaces
  - `helpers.ts`            # helper functions
  - `client.ts`             # client entry point
  - `server.ts`             # server entry point
  - `context.ts`            # server context class
  - `marvin.ts`             # entry point, runs client or server
  - `declare.d.ts`          # declares modules (i.e. bun:test)
  - `**/*.test.ts`          # test files
  - `**/*.mock.ts`          # mock files

## Workspace Structure

Loaded from `~/.marvin/` at runtime (created on first run):

- `~/.marvin/`
  - `marvin.json`       # config: settings, channels, models, agents
  - `MARVIN.md`         # assistant identity file
  - `agents/`
    - `agent-1/`
      - `tasks/`
        - `task-1.md`   # task prompt — seeds the AI loop
      - `IDENTITY.md`   # agent identity file
  - `tools/`            # user-defined tools (mirrors src/tools/)
    - `index.ts`
    - `doSomething.ts`

---

## Core Concepts

- `Model` — `MyModel extends Model`; provider logic + LLM config
- `Chat` — conversation history (messages, thinking, …)
- `Message` — single entry in the chat history
- `Channel` — user-facing output: Slack, Discord, Telegram, email, …
- `Tool` — executable action: `webSearch`, `webBrowse`, `getDate`, …
- `Agent` — runs scheduled tasks; communicates via configured channels
- `Task` — periodic prompt or `.md` file that starts the AI loop
- `execTask` — engine: runs the AI loop, then reschedules itself

Common types live in `types.ts`. Both `client.ts` and `server.ts` are self-contained entry points for their respective modes.

---

## Workflow

1. Read this file, then inspect the relevant source files
2. Identify the **smallest correct change**
3. Apply it; re-read changed files and check for errors
4. Validate the result
5. Summarize what changed and why

## Rules

- Prefer small, focused edits — avoid unrelated cleanup
- Preserve existing style, conventions, and formatting unless asked
- No new dependencies unless necessary; explain any non-obvious tradeoffs
- All changes must stay compatible with the current codebase

## Task Backlog
`TODO.md` file contains project's for pending taks, code that needs to be implemented, and other notes.
Completed items in `TODO.md` should be removed.

---

## Goal

Build an AI assistant similar to **OpenClaw**.
