# mArvIn
mArvIn - you AI sidekick

## init
```bash
git init
npm init -y
npm install -D typescript @types/node
npx tsc --init
tsc # compile/build

npm install @slack/socket-mode @slack/web-api
```

## plan
- app config + init
- channels load using config (`channels: {slack:{apiKey:""}}`)
- agents load using config.models (`agents: {"agent-id":{model:"deepseek-v4-flash"}`) (`models: {"deepseek-v4-flash":{baseUrl:"", apiKey:""}}`)
- agent heartbeat (run a prompt every X seconds)
- agent memory (store messages, prompts, etc)
- agent markdown files (from doc/templates)
