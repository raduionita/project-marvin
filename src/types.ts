export type Mode = 'client' | 'daemon';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Provider = 'deepseek' | 'lmstudio' | 'openai' | 'qwen' | 'anthropic' | 'google';
export type Thinking = 'enabled' | 'disabled';
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Config {
  timestamp: number;
  settings: {
    name: string;
    port: number;
    logLevel: LogLevel;
  };
  channels: Record<string, {
    enabled: boolean;
    [key: string]: any;
  }>;
  models: Record<string, {
    enabled: boolean;
    provider: Provider;
    model: string;
    baseUrl: string;
    apiKey: string;
  }>;
  agents: Record<string, {
    enabled: boolean;
    model: string;
    channels: Record<string, string>;
    tools: string[];
    tasks: Record<string, {
      enabled: boolean;
      interval: number;
      maxSteps: number;
      input: string;
    }>;
  }>;
}

export abstract class Plugin {
  abstract attach(settings?: Record<string, any>): Promise<any>;
  abstract detach(): void;
}

export abstract class Tool {
  abstract name(): string;
  abstract description(): string;
  abstract args(): { [name: string]: { type: string; description: string; items?: { type: string }; required: boolean } };
  abstract call(ctx: any, args: any): Promise<any>;
}

// channel interface
export abstract class Channel {
  abstract attach(context: any): Promise<any>;
  abstract detach(): void;
}

// task keeps track of the setTimeout id, schedule
export interface Task {
  enabled: boolean;
  schedule: number;
  maxSteps: number;
  timeout: NodeJS.Timeout;
  input: string;
}

// model interface class
export abstract class Model {
  // model is enabled or disabled
  public enabled: boolean = true;
  // model provider (e.g. lmstudio, openai, anthropic, deepseek, etc.)
  public provider: Provider = 'lmstudio';
  // model field refers to the LLM identifier.
  public model: string = 'qwen/qwen3.6-35b-a3b';
  // baseUrl is the url to the model provider's API endpoint
  public baseUrl: string = 'http://localhost:1234';
  // apiKey is the API key for the model provider
  public apiKey: string = 'NO_API_KEY';

  constructor(config: Partial<Model>) {
    Object.assign(this, config);
  }

  abstract chat(chat: Chat): Promise<any>;
}

export interface Agent {
  enabled: boolean;
  // inside the task, the agent will send messages through these channels to the user/owner
  channels: Record<string, string>;
  // will use this model to communicate with the LLMs
  model: Model;
  // a task is basically a setTimeout that will execute the AI loop then rerun/reschedule itself
  tasks: Record<string, Task>;
}

export interface Message {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface Chat {
  thinking: boolean;
  messages: Message[];
}
