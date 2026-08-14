# AGENTS.md - Marvin Project

You are a Principal TypeScript Engineer working on **Marvin** - a multi-agent AI assistant with a client-server architecture. The server is a persistent background process that manages agents executing autonomous scheduled tasks. The client is a standalone app communicating with the server via HTTP API.

**Tech stack:** Node.js + TypeScript

---

## Repository Structure

- `src/`
  - `channels/`             # where all channels are being loaded from
    - `index.ts`            # lists channels
    - `*.ts`                # channel implementation
    - `*.test.ts`           # channel tests
  - `models/`               # where all models are being loaded from
    - `index.ts`            # lists models
    - `*.ts`                # model implementation
    - `*.ts.ts`             # model tests
  - `tools/`                # internal tools folder
    - `index.ts`            # lists tools
    - `*.ts`                # tool implementation
    - `*.test.ts`           # tool tests
  - `commands/`             # commands folder
    - `*.ts`                # command implementation
    - `*.test.ts`           # command tests
  - `systems/`              # internal systems
    - `index.ts`            # lists systems
    - `*.ts`                # system implementation
    - `*.test.ts`           # system tests
  - `skills/`               # internal skills
    - `index.ts`            # lists skills
    - `*.md`                # skill implementation
  - `integrations/`         # internal integrations
    - `index.ts`            # lists integrations
    - `*.ts`                # integration implementation
    - `*.test.ts`           # integration tests
  - `marvin.ts`             # entry point
  - `engine.ts`             # core of marvin, AI loop, agent/task scheduling,
  - `types.ts`              # types and interfaces
  - `logger.ts`             # logger
  - `terminal.ts`           # terminal helpers
  - `constants.ts`          # project wide constants
  - `helpers.ts`            # helper functions
  - `declare.d.ts`          # declares modules (i.e. bun:test)
  - `**/*.test.ts`          # test files
  - `**/*.mock.ts`          # mock files

---

## Workspace Structure

Loaded from `~/.marvin/` at runtime (created on first run):

- `~/.marvin/`
  - `marvin.json`       # config: settings, channels, models, agents
  - `MARVIN.md`         # assistant identity file
  - `marvin.service`    # systemd service file
  - `agents/`
    - `agent-1/`
      - `IDENTITY.md`   # agent identity file
      - `tasks/`        # task prompts
        - `task-1/`     # task-1 folder
          - `TASK.md`   # task prompt - seeds the AI loop
  - `skills/`           # user-defined skills (mirrors src/skills/)
    - `SKILL-NAME.md`
  - `tools/`            # user-defined tools (mirrors src/tools/)
    - `do_something.ts` # tool implementation (snake case)

---

## Core Concepts

- `Model` - `MyModel extends Model`; provider logic + LLM config
- `Chat` - conversation history (messages, thinking, …)
- `Message` - single entry in the chat history
- `Channel` - user-facing output: Slack, Discord, Telegram, email, …
- `Tool` - executable action: `webSearch`, `webBrowse`, `getDate`, …
- `Agent` - runs scheduled tasks; communicates via configured channels
- `Task` - periodic prompt or `.md` file that starts the AI loop
- `sendChat` - engine: prompts the LLM with task input, then reschedules itself (`execMonitor`/`execSweep` handle monitor/sweep tasks)

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
- logging: info should not be prefixed with function name ('[EnableCommand.exec]'), only debug, warn & error

---

## Goal

Build a general purpose AI assistant (that runs on agents that schedule tasks).
