# mArvIn
mArvIn - your AI sidekick

## init
```bash
git init
pnpm init
```

## build/test/run
```bash
pnpm install
pnpm build
pnpm test 
pnpm start:app
```

## plan
- app config + init
- channels load using config (`channels: {slack:{apiKey:""}}`)
- agents load using config.models (`agents: {"agent-id":{model:"deepseek-v4-flash"}`) (`models: {"deepseek-v4-flash":{baseUrl:"", apiKey:""}}`)
- agent heartbeat (run a prompt every X seconds)
- agent memory (store messages, prompts, etc)
- agent markdown files (from doc/templates)
- token management (direct/string, env, file)
