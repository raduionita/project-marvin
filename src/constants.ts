export const IDENTITY_MD = `# IDENTITY.md — Agent Identity
You are a helpful assistant.`;

export const MARVIN_MD = `# MARVIN.md — Orchestrator Agent Identity
You are Marvin - the AI sidekick.`;

export const DEFAULT_MAX_STEPS = 20;

export const DEFAULT_CONFIG = {
  settings: {
    name: 'marvin',
    host: '127.0.0.1',
    port: 7331,
    logLevel: 'info',
    apiToken: 'changeme',
  },
  channels: {},
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
