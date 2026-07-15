# TODO.md

## Urgent tasks
- Slack: Before running agents autonomously, channel integrations need to be tested (i.e. Slack to Marvin and back), flow:
  - Slack sends a message to Marvin
  - Marvin pipes the messages to the LLM
  - LLM replies to Marvin
  - Marvin sends it back to Slack (same slack channel)
- Model.chat() NEEDS to return a proper (provider agnostic) result type, or a custom type that supports ALL providers
- DRY (Don't Repeat Yourself) feature with flag (--dry), only console.log calls get executed
- Tools: NEED internal stop tool for the AI loop (e.g. `endChat` or `stopChat`)

- Agents: add ochestrator/default agent "marvin", that also acts like a fallback, if no agent is found

## Major tasks
- Session: a Session object should wrap around Chat
- server.ts: execTask: wrap the whole loop in a Conversation (or something similar), to monitor all api calls and tokens used
- Agents: finish add support for multiple channels, e.g. Slack, Telegram, Discord, etc.
- Client: interactive mode (i.e. `marvin add agent`) and non-interactive mode (i.e. `marvin add agent agent-1 ...`)
- Client: create agents `marvin add agent`, tasks `marvin add task`, tools `marvin add tool`
- Client: enable channel `marvin add channel`, enable model, add tool
- Client: should use the LLM to help create the input (TASK.md) & system (IDENTITY.md) prompts
- More internal AI tools needed: for getting marvin config, state, reading marvin files, editing files

- Installer: need to have an installer that gets the project and installs the compiled binary (or lookalike) in the correct location
  - run `marvin` without `bun` or `node` in the beginning
- Installer: after install, marvin will run in the background (service/daemon), controled by client calls `marvin add...`

- Client: add --help or -h flag

- Slack: threads, when messageing @marvin, Marvin should reply in a thread (not a new message), the thread will becode chat history

## Minor tasks


## Backlog
- LMM response streaming
- Move as many of the validations to initiation to avoid constant validations
