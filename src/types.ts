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
      schedule: number;
      maxSteps: number;
      input: string;
    }>;
  }>;
}

export abstract class App {
  abstract start(): Promise<void>;
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
  abstract attach(daemon: App): Promise<void>;
  abstract detach(): void;
  abstract submit(message: Message): Promise<void>;
}

// task keeps track of the setTimeout id, schedule
export interface Task {
  enabled: boolean;
  schedule: number;
  maxSteps: number;
  timeout: NodeJS.Timeout | null;
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

  public temperature: number = 0.7;
  public topP: number = 0.9;
  public maxTokens: number = 8192;
  public n: number = 1;
  public userId: string = 'user-id';
  public reasoning: string = 'high';

  constructor(config: Config['models'][string]) {
    Object.assign(this, config);
  }

  // sends messages to LLM model
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
  channel?: string;
  tool_call_id?: string;
}

export interface Chat {
  thinking: boolean;
  messages: Message[];
}
