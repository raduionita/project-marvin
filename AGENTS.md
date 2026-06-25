# AGENTS.md — Marvin Project

You are a Principal Typescript Engineer

## Overview
Marvin is a multi-agent AI assistant system with a client-daemon architecture. The daemon runs as a persistent background process, managing agents that autonomously execute tasks on schedules. The client is a standalone application that communicates with the running daemon via an HTTP API.

## Tech stack
- NodeJS
- Typescript

## Repository Structure
Marvin source code is organized into the following folders:
- `src/`
  - `channels/`             # where all channels are being loaded from
    - `index.ts`            # lists channels
    - `slack.ts`            # channel implementation
  - `models/`               # where all models are being loaded from
    - `index.ts`            # lists models
    - `lmstudio.ts`         # local lmstudio model-provider implementation
    - `openai.ts`           # openai model-provider implementation
    - `anthropic.ts`        # anthripic model-provider implementation
    - `deepseek.ts`         # deepseek model-provider implementation
  - `tools/`                # internal tools folder
    - `index.ts`            # lists tools
    - `getDate.ts`          # tool implementation
    - `webBrowse.ts`        # tool implementation
    - `webSearch.ts`        # tool implementation
  - `types.ts`              # types and interfaces
  - `helpers.ts`            # helper functions
  - `client.ts`             # client entry point  
  - `daemon.ts`             # daemon entry point
  - `context.ts`            # daemon context class
  - `marvin.ts`             # entry point, runs client or daemon
  - `declare.d.ts`          # declares modules (i.e bun:test module)
  - `**/*.test.ts`          # test files
  - `**/*.mock.ts`          # mock files

## Workspace Structure
After marvin is installed, marvin loads its config and data from:
- `~/.marvin/`          # marvin home folder
  - `marvin.json`       # config file
  - `MARVIN.md`         # assistant identity file
  - `agents/`           # agents folder
    - `agent-1/`        # agent folder
      - `tasks/`        # agent-1 tasks folder
        - `task-1.md`   # agent-1 task-1 markdown file
      - `IDENTITY.md`   # agent-1 identity file
  - `tools/`            # custom tools folder
    - `index.ts`        # simialr to `src/tools/index.ts` in the repo, has custom tools 
    - `doSomething.ts`  # custom tool file


## Knowledge Base (in the context of the project)
- a model implementation class (MyModel extends Model) is ca combination of provider logic + llm info
- Chat is a class that holds the conversation history (messages, thinking,...)
- Message represents a single message in the chat history
- common types are defined in types.ts
- the project has 2 modes: client and daemon
- daemon.ts is the entry point for the daemon, all logic related to the daemon is in this file
- client.ts is the entry point for the client, all logic related to the client is in this file
- on first run, the client will create a config file in the user's home folder (~/.marvin/marvin.json)
- the marvin.json config file is a json file that contains the project config (settings, channels, models, agents)
- channels are they way to communicate with the user (slack, discord, telegram, email, etc.)
- models are way to communicate with the AI (openai, anthropic, deepseek, etc.)
- tools are the way to execute actions (webSearch, webBrowse, getDate, etc.)
- agents execute execute autonomous tasks, and communicate through their defined channels
- tasks are ran periodically, on schedule, they contain a direct prompt or a markdown file that starts the AI loop
- `execTask` is the engine of the assistant, runs the AI loop then reschedules itself

## Rules
- Read this file before making changes
- Prefer small, focused edits
- Preserve existing style and conventions
- Do not introduce new dependencies unless necessary
- Explain any non-obvious tradeoff in the final response
- After each major change, you MUST re-read the files, check for errors

## AI Agent Workflow
1. Inspect the relevant files
2. Identify the smallest correct change
3. Apply the change
4. Reread the files, check for errors
5. Validate the result
6. Summarize what changed and why

## Constraints
- Avoid unrelated cleanup
- Do not modify formatting-only unless requested
- Keep changes compatible with the current codebase

## GOALS
- build an AI assistant similar to OpenClaw
