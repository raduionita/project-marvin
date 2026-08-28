import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type Engine from './engine.js';
import type { Logger } from './logger.js';
import type { Chat, Model, Reply, Result, ToolMeta } from './types.js';
import { Integration } from './types.js';
import * as constants from './constants.js';
import { readMemorySummary } from './memory.js';
import { truncate, splitMcpToolName, splitIntegrationToolName } from './helpers.js';

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
  // chat seeded with the system prompt (identity + integrations + memory)
  loadChat(chatId: string | undefined, tools?: ToolMeta[]): Chat {
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
    return this.makeChat(chatId, tools);
  }

  // make new chat seeded with the system prompt (identity + integrations + memory)
  makeChat(chatId: string | undefined, tools?: ToolMeta[]): Chat {
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
        actions: {},
        arguments: {},
      };
      const endpoint = config?.endpoint || config?.url || config?.baseUrl || '';
      const actions = Object.keys(meta.actions).length
        ? `\nActions: ${Object.entries(meta.actions).map(([name, description]) => `${name} - ${description}`).join('; ')}`
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

    // inject the mcps block: loaded servers list their tools, config-only
    // entries just their spawn spec
    const mcpBlocks = Object.entries(this.engine.mcps).map(([id, client]) => {
      const tools = Object.keys(client.tools).length
        ? `\nTools: ${Object.keys(client.tools).join('; ')}`
        : '';
      return `### ${id}${tools}`;
    });
    const mcpConfigBlocks = Object.keys(this.engine.config.mcps || {})
      .filter(id => !this.engine.mcps[id])
      .map(id => `### ${id} (not connected)`);
    const allMcpBlocks = [...mcpBlocks, ...mcpConfigBlocks];
    if (allMcpBlocks.length) {
      system += '\n\n';
      system += '## Mcps\n';
      system += allMcpBlocks.join('\n');
    }

    // inject a compact summary of the most recently updated memory notes, so
    // the agent keeps cross-run context (facts, preferences, progress)
    if (this.engine.config.settings.memory || this.memory) {
      const memory = readMemorySummary(this.engine, this.id);
      if (memory) {
        system += '\n\n';
        system += '## Memory\n';
        system += memory + '\n';
        system += 'Use the memory tool (remember/recall) to read and update these notes.';
        this.logger.debug('[Agent.makeChat]', 'memory:', memory);
      }
    }

    return {
      id: chatId,
      messages: [{ role: 'system', content: system }],
      thinking: false,
      userId: '',
      tools: [...Object.values(this.engine.tools).map(t => t.meta), ...(tools || [])],
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
    if (chat.messages.length <= constants.MAX_CHAT_MESSAGES) {
      // no trimming needed
      return;
    }

    // TODO: trim middle approach

    // drop the oldest messages, always keeping the system message (index 0)
    const drop = chat.messages.length - constants.MAX_CHAT_MESSAGES;
    if (chat.messages[0]?.role === 'system') {
      chat.messages = [chat.messages[0]!, ...chat.messages.slice(drop + 1)];
    } else {
      chat.messages = chat.messages.slice(drop);
    }

    // drop tool messages left without their assistant tool_calls parent right
    // after the trim point: APIs reject tool responses with no matching
    // tool_calls message before them
    let keep = chat.messages[0]?.role === 'system' ? 1 : 0;
    let scan = keep; // = 1
    while (scan < chat.messages.length && chat.messages[scan]!.role === 'tool') scan++;
    if (scan > keep) chat.messages = [...chat.messages.slice(0, keep), ...chat.messages.slice(scan)];
  }

  // tool call
  async execTool(tool: string, args: {[key:string]:any}, chat?: Chat) : Promise<{[key:string]:any}> {
    this.logger.debug('[Agent.execTool]', tool);
    try {
      // internal tools
      const instance = this.engine.tools[tool];
      if (instance) {
        // ! tool call
        return await instance.call(args, this, chat);
      }

      // integration tools (<integrationId>__<action>) loaded per-task
      const intSplit = splitIntegrationToolName(tool);
      const integration = intSplit ? this.engine.integrations[intSplit.id] : undefined;
      if (integration) {
        return await integration.call({ action: intSplit!.action, ...args });
      }

      // mcp tools (<mcpId>__<toolName>) loaded per-task
      const mcpSplit = splitMcpToolName(tool);
      const mcp = mcpSplit ? this.engine.mcps[mcpSplit.id] : undefined;
      if (mcp) {
        return await mcp.call(mcpSplit!.name, args);
      }
    } catch (err) {
      this.logger.error('[Agent.execTool]', `tool ${tool} failed:`, err);
      return {tool: tool, error: (err as Error).message};
    }
    // not found
    this.logger.error('[Agent.execTool]', `tool ${tool} not found`);
    return {tool: tool, error: `tool ${tool} does NOT exist`};
  }

  // exec chat // agent loop
  async sendChat(chatId: string | undefined, message: string, tools?: ToolMeta[]) : Promise<Result> {
    try {
      this.logger.debug('[Agent.sendChat]', `chatId=${chatId} agent=${this.id}, message=${message.slice(0, 32)}`);

      // get chat from cache/store, or create a new one seeded with the system prompt
      const chat = this.loadChat(chatId, tools);

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
      let tokens = 0;
      do {
        steps++;

        // keep the chat history bounded (system message + last N messages)
        this.packChat(chat);

        // ! AI call // core of the AI loop: call model, execute tool calls, repeat until done
        reply = await this.model.execChat(chat);
        tokens += reply.usage.completion + reply.usage.prompt;

        // persist assistant reply to chat history
        chat.messages.push({ role: 'assistant', content: reply.message.content?.trim() || '', tools: reply.message.tools });

        // trim result, this can be really big
        this.logger.debug('[Agent.sendChat]', `ended=${ended}`, `step=#${steps}`, `tools=${reply.message.tools?.map(t => t.name)}`);

        ended = reply.stop || ended;
        // execute any tool calls
        for (const call of reply.message.tools || []) {
          this.logger.debug('[Agent.sendChat]', `executing tool: ${call.name}`, Object.keys(call.arguments));
          // tool MUST exist
          const tool = this.engine.tools[call.name] 
          if (!tool) {
            this.logger.error('[Agent.sendChat]', `tool ${call.name} not found`);
            continue;
          } else if (tool.stop) {
            ended = true;
            chat.messages.push({role: 'tool', content: JSON.stringify({ ended: true }), toolId: call.id});
          } else if (ended) {
            // tools after end_chat are skipped, but their ids still need an answer
            chat.messages.push({role: 'tool', content: JSON.stringify({ skipped: true }), toolId: call.id});
          } else {
            // ! tool call
            let result = await this.execTool(call.name, call.arguments, chat);  
            // add tool call to chat history, truncating huge results (e.g. full
            // web pages) so they cannot blow past the model context window
            chat.messages.push({role: 'tool', content: truncate(JSON.stringify(result), constants.MAX_TOOL_RESULT_CHARS), toolId: call.id});
          }
        }
      } while ((!ended) && (steps < constants.DEFAULT_MAX_STEPS - 1));

      // warn if max steps reached
      if (steps >= constants.DEFAULT_MAX_STEPS) {
        this.logger.warn('[Agent.sendChat]', `max steps reached for ${this.id}`);
      }

      // save chat to cache
      this.saveChat(chatId, chat);

      return { content: (reply?.message?.content || '').trim(), steps: steps, tokens: tokens };
    } catch (error) {
      this.logger.error('[Agent.sendChat]', error);
      return { content: '', steps: 0, error: (error as Error).message };
    } 
  }
}
