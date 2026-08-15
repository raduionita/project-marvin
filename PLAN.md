# PLAN.md - Marvin Project Plan

- [~] 2.7 Usage / token monitoring on the loop — partial (only `DeepseekModel`/`fallback` report usage)
- [ ] 6.9 LLM-assisted generation of `TASK.md` & `IDENTITY.md` — NOT implemented
- [ ] 6.10 global `--help` / `-h` flag — NOT implemented (only per-command `help` subcommands)
- [~] 7.4 Compiled binary (`bun build --compile`) — script exists; `bin/marvin.js` is a broken stub
- [ ] 8.1 LLM response **streaming**
- [ ] 8.2 Move validations from runtime to **load time**
- [ ] 8.3 Interactive chat loop (`/exit` `/quit` `/stop`) in `agents` chat — TODO in code
- [~] **Model result type** — `Reply` defined, but only `deepseek`/`fallback` conform; others are `any`.
- [ ] **More internal tools** — not implemented (Phase 3).
- [ ] **LLM-assisted prompt gen** — not implemented (Phase 6).
- [ ] **Streaming** — not implemented (Phase 8).
