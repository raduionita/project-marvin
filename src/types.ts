import type Engine from "./engine";
import type { Agent } from './agent.js';
import type { Logger } from "./logger.js";

export type Mode = 'client' | 'server';

// a selectable entry in a terminal select/multiselect prompt
export type Option<T = string> = { label: string; value: T };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Provider = 'fallback' | 'deepseek' | 'lmstudio' | 'openai' | 'qwen' | 'anthropic' | 'google';
export type Thinking = 'enabled' | 'disabled';
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Config {
  settings: {
    name: string;
    host: string;
    port: number;
    apiToken?: string;
    memory?: boolean;
  };
  channels: Record<string, {
    enabled?: boolean;
    [key: string]: any;
  }>;
  integrations: Record<string, {
    enabled?: boolean;
    type: string;
    [key: string]: any;
  }>;
  models: Record<string, {
    enabled: boolean;
    provider: Provider;
    model: string;
    baseUrl?: string;
    apiKey?: string;
  }>;
  agents: Record<string, {
    enabled: boolean;
    default?: boolean;
    model?: string;
    channels: Record<string, string>;
    tools?: string[];
  }>;
  tasks?: Record<string, {
    enabled: boolean;
    type?: TaskType;
    agent?: string;
    schedule: number;
    maxSteps: number;
    input?: string;
    format?: 'text' | 'json';
    schema?: {[key:string]:string};
    // integrations linked to this task: their actions become tools
    integrations?: string[];
  }>;
}

export class Command {
  constructor(public engine: Engine, public logger: Logger, public args: string[], public readonly deamon: boolean = false) {
    this.logger.debug(`[${this.constructor.name||'Command'}.constructor]`, JSON.stringify(args));
  }

  async exec(): Promise<void> { this.logger.debug(`[${this.constructor.name||'Command'}.exec]`); }
  async drop(): Promise<void> { this.logger.debug(`[${this.constructor.name||'Command'}.drop]`); }
}

export abstract class System {
  constructor(public readonly engine: Engine, public readonly logger: Logger) {
    this.logger.debug(`[${this.constructor.name||'System'}.constructor]`);
  }

  abstract load(): Promise<void>;
  abstract drop(): Promise<void>;
}

export type ToolMeta = { type: string, function: {name:string, description:string, parameters:{type:string, properties:{[key:string]:{type:string, description:string, enum?:string[]}}, required?:string[]}} };

export abstract class Tool {
  constructor(public engine: Engine, public logger: Logger) {
    this.logger.debug(`[${this.constructor.name||'Tool'}.constructor]`);
  }

  public abstract readonly meta: ToolMeta;

  public abstract call(args: {[key:string]:any}): Promise<{[key:string]:any}>;
}

// channel interface
export abstract class Channel {
  abstract args: {[key: string]: any};

  constructor(public engine: Engine, public logger: Logger) {
    this.logger.debug(`[${this.constructor.name||'Channel'}.constructor]`);
  }

  abstract load(): Promise<void>;
  abstract drop(): Promise<void>;

  abstract listGroups(): Promise<{[key:string]:string}>;
  abstract sendMessage(message: Message): Promise<{ok:boolean, error:string|undefined, message?:string}>;
}

// a single parameter/field an integration action accepts (used to build the
// call_integration tool schema and to prompt the user during `marvin
// integrations add`). derived from the provider's API schema via discovery.
export interface Field {
  // field name as sent to the provider (e.g. title, content, meta)
  name: string;
  // parameter type: string, number, boolean, object, array, integer
  type: string;
  // required by the provider (schema "required" or user-marked during add)
  required: boolean;
  // human readable description of what the field is for
  description: string;
  // allowed values, when the provider restricts them (e.g. post status)
  enum?: string[];
  // target when the field is a custom/meta field: meta, acf or undefined
  meta?: 'meta' | 'acf';
}

export interface IntegrationAction {
  // action name passed to Integration.call (e.g. create_post)
  name: string;
  // one line description shown to the user and the LLM
  description: string;
}

// what an integration type is capable of, without any per-site configuration.
export interface IntegrationMeta {
  // integration type (e.g. wordpress)
  type: string;
  // human readable title (e.g. "Wordpress")
  title: string;
  // one line description (e.g. "Post articles to a Wordpress site")
  description: string;
  // all actions this integration type supports
  actions: IntegrationAction[];
}

// integration interface: a bridge to a 3rd party endpoint (e.g. Wordpress API)
export abstract class Integration {
  abstract args: {[key: string]: any};
  // static info about this integration type (type, title, description, actions).
  // used to build the ## Integrations system-prompt block and the wizard prompts.
  abstract meta: IntegrationMeta;

  constructor(public engine: Engine, public logger: Logger, public config: { [key: string]: any }) {
    this.logger.debug(`[${this.constructor.name||'Integration'}.constructor]`);
  }

  abstract load(): Promise<void>;
  abstract drop(): Promise<void>;
  // run a named action on the integration (e.g. create_post, publish_post)
  abstract call(args: {[key:string]:any}): Promise<{[key:string]:any}>;

  // discover the fields an action accepts from the provider (e.g. via OPTIONS
  // on the Wordpress REST API). returns normalized FieldDef[], throws when the
  // provider cannot be reached or exposes no schema.
  async discover(_action: string): Promise<Field[]> {
    return [];
  }
}

// skill meta data, populated on engine load. The .md content itself is loaded
// dynamically (see skills/readSkill) and not kept in memory.
export interface Skill {
  // skill name = file name without extension (e.g. "meta", "tools")
  id: string;
  // human readable title (first # heading, falls back to id)
  title: string;
  // short description (first paragraph, falls back to "")
  description: string;
  // absolute path to the SKILL-NAME.md file
  file: string;
  // default: shipped in src/skills, custom: user created in ~/.marvin/skills
  source: 'default' | 'custom';
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

  public temperature: number = 1.0;
  public topP: number = 0.95;
  public topK: number = 40;
  public maxTokens: number = 8192;
  public n: number = 1;
  public userId: string = 'user-id';
  public reasoning: string = 'high';
  public format: 'text' | 'json' = 'text';

  constructor(public readonly engine: Engine, public readonly logger: Logger, config: { [key: string]: any }) {
    Object.assign(this, config);
  }

  // sends messages to LLM model
  abstract execChat(chat: Chat): Promise<Reply>;
}

// task keeps track of the setTimeout id, schedule
export type TaskType = 'task' | 'monitor' | 'sweep';

// single unit of work for the agent ai loop
export interface Task {
  // same as id in tasks[id]
  id: string;
  // enabled=false = suspended for now
  enabled: boolean;
  // what the task does: prompt the LLM (input), watch the state (monitor), or clean up (sweep)
  type: TaskType;
  // agent
  agent?: Agent;
  // TODO: schedule to cron-like format
  schedule: number;
  // max number of steps to run agent loop
  maxSteps: number;
  // timeout = setTimeout()
  timeout: NodeJS.Timeout | null;
  // task prompt for the LLM
  input?: string;
  // format, defaults to 'json'
  format?: 'text' | 'json';
  // is json, what schema
  schema?: {[key:string]:string};
  // integrations linked to this task: their actions become tools for this task
  integrations?: string[];
}

// chat = message history + format + tools
export interface Chat {
  // used for cache retrieval, restore chat state and continue
  id: string;
  // thinking is enabled or disabled
  thinking: boolean;
  // messages is the chat history
  messages: Message[];
  // tools
  tools?: ToolMeta[];
  // format
  format?: 'text' | 'json';
  // userId is the user's id
  userId?: string;
  // last time this chat was used (for TTL eviction)
  updated?: number;
  // sum/total of all usages (Reply.usage)
  usage?: {
    completion: number;
    prompt: number;
  }
}

// multi-purpose (models, channels) message
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
    arguments: {[key:string]:any};
  }[];
}

// LLM Model sendChat reply
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
}

// sendChat result
export interface Result {
  content: string;
  steps: number;
  error?: string;
}
