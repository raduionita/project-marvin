export type Mode = 'client' | 'server';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Provider = 'fallback' | 'deepseek' | 'lmstudio' | 'openai' | 'qwen' | 'anthropic' | 'google';
export type Thinking = 'enabled' | 'disabled';
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Config {
  settings: {
    name: string;
    host: string;
    port: number;
    logLevel: LogLevel;
    apiToken?: string;
  };
  channels: Record<string, {
    enabled?: boolean;
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
    default?: boolean;
    model?: string;
    channels: Record<string, string>;
    tools?: string[];
    tasks?: Record<string, {
      enabled: boolean;
      schedule: number;
      maxSteps: number;
      input: string;
    }>;
  }>;
}

export class Command {
  public ctx: Context;

  constructor(ctx: Context) {
    console.debug(`[${this.constructor.name||'Command'}.constructor]`);
    this.ctx = ctx;
    this.ctx.command = this;
  }

  async init(): Promise<void> { console.debug(`[${this.constructor.name||'Command'}.init]`); }
  async drop(): Promise<void> { console.debug(`[${this.constructor.name||'Command'}.drop]`); }
}

export class Context {
  public state: 'running' | 'reloading' | 'stopped' = 'running';

  public command: Command = {} as Command;

  public config: Config = {} as Config;

  public cache: Cache = new Cache();

  // TODO: later consider moving browser, http, watch (file watcher) to a separate group "systems"
  public systems: Record<string, System> = {};

  // channels, models, agents
  public channels: Record<string, Channel> = {};
  public tools   : Record<string, Tool> = {};
  public models  : Record<string, Model> = {};
  public agents  : Record<string, Agent> = {};

  // home (~/.marvin) data folder
  public home: string = '';
  // root (~/) app folder
  public root: string = '';

  public isDry: boolean = process.argv.includes('--dry') || process.argv.includes('-dry');
  public isTest: boolean = process.env.NODE_ENV === 'test' || process.env.BUN_TEST === '1';

  public get isDebug() { return this.config.settings.logLevel === 'debug'; }
}

export abstract class System {
  public ctx: Context;

  constructor(ctx: Context) {
    console.log('System.constructor', this.constructor.name);
    this.ctx = ctx;
  }

  abstract init(): Promise<void>;
  abstract drop(): Promise<void>;
}

export type ToolMeta = { type: string, function: {name:string, description:string, parameters:{type:string, properties:{[key:string]:{type:string, description:string}}, required:string[]}} };

export abstract class Tool {
  constructor(public readonly ctx: Context) {
    console.log(`${this.constructor.name||'Tool'}.constructor`);
  }

  public abstract readonly meta: ToolMeta;

  public abstract call(args: {[key:string]:any}): Promise<{[key:string]:any}>;
}

// channel interface
export abstract class Channel {
  constructor(public readonly ctx: Context) {
    console.log(`${this.constructor.name||'Channel'}.constructor`);
  }

  abstract args(): {[key: string]: any};
  abstract init(): Promise<void>;
  abstract drop(): Promise<void>;

  abstract sendMessage(message: Message): Promise<any | null>;
}

// task keeps track of the setTimeout id, schedule
export interface Task {
  id: string;
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
  // model is the default model for the agent
  public default: boolean = false;
  // model provider (e.g. lmstudio, openai, anthropic, deepseek, etc.)
  public provider: Provider = 'lmstudio';
  // model field refers to the LLM identifier.
  public model: string = 'qwen/qwen3.6-35b-a3b';
  // baseUrl is the url to the model provider's API endpoint
  public baseUrl: string = 'http://localhost:1234';
  // apiKey is the API key for the model provider
  public apiKey: string = 'NO_API_KEY';

  public temperature: number = 0.7;
  public topP: number = 0.95;
  public topK: number = 40;
  public maxTokens: number = 8192;
  public n: number = 1;
  public userId: string = 'user-id';
  public reasoning: string = 'high';
  public format: 'text' | 'json' = 'text';
  public tools: ToolMeta[]; // 

  constructor(public readonly ctx: Context, config: { [key: string]: any }) {
    Object.assign(this, config);
    this.tools = Object.values(this.ctx.tools).map(tool => tool.meta);
  }

  // sends messages to LLM model
  abstract sendMessage(chat: Chat): Promise<Reply>;
}

export interface Agent {
  id: string;
  // agent is enabled or disabled
  enabled: boolean;
  // agent system prompt
  identity: string;
  // inside the task, the agent will send messages through these channels to the user/owner
  channels: Record<string, string>;
  // will use this model to communicate with the LLMs
  model: Model;
  // a task is basically a setTimeout that will execute the AI loop then rerun/reschedule itself
  tasks: Record<string, Task>;
}

export interface Chat {
  // used for cache retrieval, restore chat state and continue
  id: string;
  // thinking is enabled or disabled
  thinking: boolean;
  // messages is the chat history
  messages: Message[];
  // userId is the user's id
  userId?: string;
  // sum/total of all usages (Reply.usage)
  usage?: {
    completion: number;
    prompt: number;
  }
}

export interface Message {
  role: Role;
  content: string;
  name?: string;
  channel?: string;
  thread?: string;
  // id of the tool that this message is responding to (role=tool)
  toolId?: string;
  // tool calls generated by the model, use this to execute tools
  tools?: {
    // id of the tool call, useful for .tool_call_id
    id: string;
    // name of the function call
    name: string;
    // arguments as a JSON, might be invalid
    arguments: string; 
  }[];
}

export interface Reply {
  // chat completion id
  id: string;
  // something happened, you need to stop the AI loop
  stop: boolean;
  // finish reason, if stop is true, this is the reason
  finish?: string;
  // message, actual output of the model
  message: Message;
  // usage statistics for this completion request
  usage: {
    completion: number;
    prompt: number;
  };
  // TODO: research if choices?! would be useful
}

export class Cache {
  private cache: Record<string, any> = {}; // chatId: chat

  saveChat(chatId: string, chat: Chat): void {
    this.cache[chatId] = chat;
  }

  findChat(chatId: string): Chat {
    return this.cache[chatId] || { id: chatId, messages: [], thinking: false, userId: '', tools: [] };
  }

  // TODO: async persist to file (in the workspace folder)
}
