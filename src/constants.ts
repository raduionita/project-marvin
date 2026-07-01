export const IDENTITY_MD = `# IDENTITY.md — Agent Identity
You are a helpful assistant.`;

export const MARVIN_MD = `# MARVIN.md — Orchestrator Agent Identity
You are Marvin - the AI sidekick.`;

export const DEFAULT_MAX_STEPS = 20;

export const DEFAULT_CONFIG = {
  settings: {
    name: 'marvin',
    port: 7331,
    logLevel: 'info',
  },
  channels: {},
  models: {},
  agents: {},
};


export const EXIT_CODES = {
  OK: 0,
  ERROR: 1,
};
