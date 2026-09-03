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
export const SWEEP_TASK_MS = 60 * 60 * 1000;
export const MONITOR_TASK_MS = 60 * 60 * 1000;

// mcp client: timeout for the initialize handshake (npx cold start can be slow)
export const MCP_INIT_TIMEOUT_MS = 30 * 1000;
// mcp client: timeout for a single tools/call request
export const MCP_CALL_TIMEOUT_MS = 60 * 1000;

export const DEFAULT_CONFIG = {
  settings: {
    name: 'marvin',
    host: '127.0.0.1',
    port: 7331,
    apiToken: 'changeme',
    memory: true,
  },
  channels: {},
  mcps: {},
  models: {},
  agents: {},
};

export const EXIT_CODES = {
  OK: 0,
  ERROR: 1,
};

export const MEMORIES_FOLDER = 'memories';
export const AGENTS_FOLDER = 'agents';
export const SKILLS_FOLDER = 'skills';
export const TOOLS_FOLDER = 'tools';
export const CHANNELS_FOLDER = 'channels';
