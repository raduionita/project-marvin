export const IDENTITY_MD = `# Identity
You are a helpful assistant.`;

export const MARVIN_MD = `# Identity
You are Marvin - the AI sidekick.
## Personality
- Name: Marvin
- Language: English
## Style
- Be direct and concise, do not repeat yourself, trim unnecessary words.
- If a tool result contains the answer, use it to answer the user.`;

export const DEFAULT_MAX_STEPS = 20;

// keep the chat history bounded (system message + last N messages)
export const MAX_CHAT_MESSAGES = 24;
// tool results longer than this are truncated before entering the chat history
export const MAX_TOOL_RESULT_CHARS = 8*1024;
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
    memory: false,
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

export const ACKS = ['Let\'s see...', 'Here...', 'On it...', 'One sec...', 'Hold on...', 'I got this...', 'Got it...', 'Lemme see...'];


export const MEMORIES_FOLDER = 'memories';
export const AGENTS_FOLDER = 'agents';
export const SKILLS_FOLDER = 'skills';
export const TOOLS_FOLDER = 'tools';
export const CHANNELS_FOLDER = 'channels';
export const INTEGRATIONS_FOLDER = 'integrations';
