import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type Engine from './engine.js';
import type { Logger } from './logger.js';
import type { Chat, IntegrationAction, Model, Reply, Result, ToolMeta } from './types.js';
import { Integration } from './types.js';
import * as constants from './constants.js';
import { cleanContent } from './helpers.js';
import { readMemorySummary } from './memory.js';
import { splitIntegrationToolName } from './integrations/index.js';

// agent: an identity (system prompt) + a model + output channels. runs the AI
// loop via sendChat (model calls + tool execution) on behalf of tasks and chats,
// and owns the chat cache (loadChat/makeChat/saveChat/packChat).
export class Agent {
  public id: string = '';
  // agent is enabled or disabled
  public enabled: boolean = true;
  // memory
  public memory?: boolean;
  // agent system prompt
  public identity: string = '';
  // inside the task, the agent will send messages through these channels to the user/owner
  public channels: Record<string, string> = {};
  // will use this model to communicate with the LLMs
  public model!: Model;

  // chat cache (chatId: chat), swept by the engine's execSweep task
  public cache: Record<string, Chat> = {};

  constructor(public engine: Engine, public logger: Logger, config: { [key: string]: any } = {}) {
    Object.assign(this, config);
    this.logger.debug(`[${this.constructor.name || 'Agent'}.constructor]`);
  }

  // get a chat for this id: reuse the cached/persisted one, or create a new
  // chat seeded with the system prompt (identity + integrations + memory + format)
  loadChat(chatId: string | undefined, format: 'text' | 'json' = 'json', schema: { [key: string]: string } = constants.DEFAULT_SCHEMA, tools?: ToolMeta[]): Chat {
    this.logger.debug('[Agent.loadChat]');

    // try from cache or disk
    if (chatId) {
      const cached = this.cache[chatId];
      if (cached) {
        cached.updated = Date.now();
        return cached;
      }

      if (!this.engine.isDry) {
        try {
          const file = join(this.engine.work, 'chats', `${chatId}.json`);
          if (existsSync(file)) {
            // load from disk, then re-cache
            const chat = JSON.parse(readFileSync(file, 'utf-8')) as Chat;
            chat.updated = Date.now();
            this.cache[chatId] = chat;
            return chat;
          }
        } catch (err) {
          this.logger.debug('[Agent.makeChat]', 'failed to load chat from disk:', err);
        }
      }
    }

    // or make a new chat
    return this.makeChat(chatId, format, schema, tools);
  }

  // make new chat seeded with the system prompt (identity + integrations + memory + format)
  makeChat(chatId: string | undefined, format: 'text' | 'json', schema: { [key: string]: string }, tools?: ToolMeta[]): Chat {
    this.logger.debug('[Agent.makeChat]');

    let system = this.identity;

    const entries = Object.entries(this.engine.integrations);
    const configs = entries.length ? entries : Object.entries(this.engine.config.integrations || {});

    const blocks = configs.map(([id, integration]) => {
      const isLoaded = integration instanceof Integration;
      const config = isLoaded ? integration.config : integration;
      const meta = isLoaded ? integration.meta :  {
        type: config?.type || 'integration',
        title: id,
        description: '',
        actions: [],
      };
      const endpoint = config?.endpoint || config?.url || config?.baseUrl || '';
      const actions = meta.actions.length
        ? `\nActions: ${meta.actions.map((a: IntegrationAction) => `${a.name} - ${a.description}`).join('; ')}`
        : '';
      const url = endpoint ? ` (${endpoint})` : '';
      return `### ${id}${url}\n${meta.description || meta.title}${actions}`;
    });

    // inject the integrations block
    if (blocks.length) {
      system += '\n\n';
      system += '## Integrations\n';
      system += blocks.join('\n');
    }

    // inject a compact summary of the most recently updated memory notes, so
    // the agent keeps cross-run context (facts, preferences, progress)
    if (this.engine.config.settings.memory || this.memory) {
      system += '\n\n';
      system += '## Memory\n';
      system += readMemorySummary(this.engine.work) + '\n';
      system += 'Use the memory tool (remember/recall) to read and update these notes.';
    }

    // add the JSON schema for JSON output
    if (format === 'json') {
      system += '\n\n';
      system += `## Output format`;
      system += 'Respond with exactly one JSON object, no other text::\n';
      system += '```json\n' + JSON.stringify(schema) + '\n```\n';
      system += '- Do not wrap the JSON in a code fence in your actual response.\n';
      system += '- Do not include any text before or after the JSON object.';
    }

    // TODO: loadIntegrationTools(integrations)

    return {
      id: chatId,
      messages: [{ role: 'system', content: system }],
      thinking: false,
      userId: '',
      format: format,
      tools: tools,
      updated: Date.now(),
    } as Chat;
  }

  // save chat to cache (and persist it to ~/.marvin/chats/<chatId>.json)
  saveChat(chatId: string | undefined, chat: Chat): void {
    this.logger.debug('[Agent.saveChat]', `chatId=${chatId}`);

    if (!chatId) return;
    chat.updated = Date.now();
    this.cache[chatId] = chat;
    if (this.engine.isDry) return;

    try {
      mkdirSync(join(this.engine.work, 'chats'), { recursive: true });
      writeFileSync(join(this.engine.work, 'chats', `${chatId}.json`), JSON.stringify(chat), 'utf-8');
    } catch (err) {
      this.logger.error('[Agent.saveChat]', 'failed to persist chat:', err);
    }
  }

  // bound chat history to the system message + the last N messages
  packChat(chat: Chat): void {
    if (!chat.messages || chat.messages.length <= constants.MAX_CHAT_MESSAGES) return;

    // TODO: trim middle approach

    // drop the oldest messages, always keeping the system message (index 0)
    const drop = chat.messages.length - constants.MAX_CHAT_MESSAGES;
    if (chat.messages[0]?.role === 'system') {
      chat.messages = [chat.messages[0]!, ...chat.messages.slice(drop + 1)];
    } else {
      chat.messages = chat.messages.slice(drop);
    }
  }

  // tool call
  async execTool(tool: string, args: {[key:string]:any}) : Promise<{[key:string]:any}> {
    this.logger.debug('[Agent.execTool]', tool);

    const instance = this.engine.tools[tool];
    if (instance) {
      try {
        // ! tool call
        return await instance.call(args);
      } catch (err) {
        this.logger.error('[Agent.execTool]', `tool ${tool} failed:`, err);
        return {tool: tool, error: (err as Error).message};
      }
    }

    // dynamic integration tools (<integrationId>__<action>) loaded per-task
    const split = splitIntegrationToolName(tool);
    const integration = split ? this.engine.integrations[split.integrationId] : undefined;
    if (integration) {
      try {
        return await integration.call({ action: split!.action, ...args });
      } catch (err) {
        this.logger.error('[Agent.execTool]', `tool ${tool} failed:`, err);
        return {tool: tool, error: (err as Error).message};
      }
    }

    this.logger.error('[Agent.execTool]', `tool ${tool} not found`);
    return {tool: tool, error: `tool ${tool} does NOT exist`};
  }

  // exec chat // agent loop
  async sendChat(chatId: string | undefined, message: string, format: 'text' | 'json' = 'json', schema: {[key:string]:string} = constants.DEFAULT_SCHEMA, maxSteps: number = constants.DEFAULT_MAX_STEPS, tools?: ToolMeta[]) : Promise<Result> {
    try {
      this.logger.debug('[Agent.sendChat]', `chatId=${chatId} agent=${this.id}, message=${message.slice(0, 32)}`);

      // get chat from cache/store, or create a new one seeded with the system prompt
      const chat = this.loadChat(chatId, format, schema, tools);

      // load task input as user message
      chat.messages.push({ role: 'user', content: message.trim() });

      // return early
      if (this.engine.isDry) {
        this.logger.info('[Agent.sendChat]', '[dry]', 'send messages to:', this.model.model);
        this.saveChat(chatId, chat);
        return { content: '(dry)', steps: 0 };
      }

      // AI loop: call model, execute tool calls, repeat until done
      let reply: Reply;
      let steps = -1;
      let ended = false;
      do {
        steps++;

        // keep the chat history bounded (system message + last N messages)
        this.packChat(chat);

        // ! AI call // core of the AI loop: call model, execute tool calls, repeat until done
        reply = await this.model.execChat(chat);

        // persist assistant reply to chat history
        chat.messages.push({ role: 'assistant', content: reply.message.content?.trim() || '', tools: reply.message.tools });

        // trim result, this can be really big
        this.logger.debug('[Agent.sendChat]', `step=#${steps}`, `tools=${reply.message.tools?.map(t => t.name)}`);

        // force stop
        if (reply.stop) {
          this.logger.debug('[Agent.sendChat]', `force stop at step=#${steps}`);
          break;
        }

        // execute any tool calls
        for (const tool of reply.message.tools || []) {
          this.logger.debug('[Agent.sendChat]', `executing tool: ${tool.name}`, JSON.stringify(tool.arguments));

          // if end_chat tool call is found, we're done
          if (tool.name === constants.END_CHAT_NAME) {
            ended = true;
            break;
          }

          // ! tool call
          let result = await this.execTool(tool.name, tool.arguments);

          // add tool call to chat history
          chat.messages.push({ role: 'tool', content: JSON.stringify(result), toolId: tool.id });
        }

        // if end_chat tool call is found, we're done
        if (ended) {
          this.logger.info('[Agent.sendChat]', `tool stop (${constants.END_CHAT_NAME}) at step=#${steps}`);
          break;
        }
      } while (steps < maxSteps - 1);

      // warn if max steps reached
      if (steps >= maxSteps) {
        this.logger.warn('[Agent.sendChat]', `max steps (${maxSteps}) reached for ${this.id}`);
      }

      // save chat to cache
      this.saveChat(chatId, chat);

      // TODO: more info here
      // when format is json, make sure content is a valid JSON string (the LLM
      // may append markup such as a <tool_calls> block after the JSON)
      return { content: reply?.message?.content || '', steps: steps };
    } catch (error) {
      this.logger.error('[Agent.sendChat]', error);
      return { content: '', steps: 0, error: (error as Error).message };
    } 
  }
}
