export const IDENTITY_MD = `# IDENTITY.md - Agent Identity
You are a helpful assistant.`;

export const MARVIN_MD = `# MARVIN.md - Orchestrator Agent Identity
You are Marvin - the AI sidekick.
## Rules
- Be direct and concise, do not repeat yourself, trim unnecessary words.
- If a tool result contains the answer, use it to answer the user.`;

export const JSON_MD = `## Output format
- ALWAYS respond in valid JSON format.
- Use EXACT keys in the JSON schema below.`;

export const DEFAULT_SCHEMA = {"output": "text string of the answer"};

export const DEFAULT_MAX_STEPS = 20;

// keep the chat history bounded (system message + last N messages)
export const MAX_CHAT_MESSAGES = 24;
// cached chats idle for longer than this are swept from memory
export const CHAT_TTL_MS = 60 * 60 * 1000;
// how often to sweep idle cached chats
export const CHAT_SWEEP_MS = 10 * 60 * 1000;

export const DEFAULT_CONFIG = {
  settings: {
    name: 'marvin',
    host: '127.0.0.1',
    port: 7331,
    apiToken: 'changeme',
  },
  channels: {},
  integrations: {},
  models: {},
  agents: {},
};

export const EXIT_CODES = {
  OK: 0,
  ERROR: 1,
};

export const END_CHAT_NAME = 'end_chat';
export const END_CHAT_DESCRIPTION = 'Call this tool ONLY when you have completed all necessary steps and are ready to give the final, definitive answer to the user.';

export const ACKS = ['Here...', 'On it...', 'One sec...', 'Hold on...', 'I got this...', 'Got it...', 'Lemme see...'];
