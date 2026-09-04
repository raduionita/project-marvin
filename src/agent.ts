import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type Engine from './engine.js';
import logger from './logger.js';
import type { Channel, Chat, Message, Model, Reply, Result, ToolMeta } from './types.js';
import * as constants from './constants.js';
import { readMemorySummary } from './memory.js';
import { truncate, splitMcpToolName as splitToolName, readError } from './helpers/index.js';

// agent: an identity (system prompt) + a model + output channels. runs the AI loop (sendChat)
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

  // shared logger (default-exported singleton from ./logger.js)
  constructor(public engine: Engine, config: { [key: string]: any } = {}) {
    Object.assign(this, config);
  }

  // get a chat for this id: reuse the cached/persisted one, or create a new
  // chat seeded with the system prompt (identity + memory)
  loadChat(chatId: string | undefined): Chat {
    logger.debug('[Agent.loadChat]', chatId);

    try {
      // try from cache or disk
      if (chatId) {
        const cached = this.cache[chatId];
        if (cached) {
          cached.updated = Date.now();
          return cached;
        }

        const file = join(this.engine.work, 'chats', `${chatId}.json`);
        if (existsSync(file)) {
          // load from disk, then re-cache
          const chat = JSON.parse(readFileSync(file, 'utf-8')) as Chat;
          chat.updated = Date.now();
          this.cache[chatId] = chat;
          return chat;
        }
      }
    } catch (err) {
      logger.debug('[Agent.makeChat]', 'failed to load chat from disk:', err);
    }

    // or make a new chat
    return this.makeChat(chatId);
  }

  // make new chat seeded with the system prompt (identity + memory)
  makeChat(chatId: string | undefined): Chat {
    logger.debug('[Agent.makeChat]', chatId);

    let system: string = this.identity;

    system += '\n\n---';

    {
      // inject a compact summary of the most recently updated memory notes, so
      // the agent keeps cross-run context (facts, preferences, progress)
      if (this.engine.config.settings.memory || this.memory) {
        const memory = readMemorySummary(this.engine, this.id);
        if (memory) {
          system += '\n\n';
          system += '## Memory\n';
          system += memory + '\n';
          system += 'Use the memory tool (remember/recall) to read and update these notes.';
          logger.debug('[Agent.makeChat]', 'memory:', memory);
        }
      }
    } // memories

    {
      // inject the mcps block: loaded servers list their tools, config-only entries just their spawn spec
      if (Object.keys(this.engine.mcps).length) {
        system += '\n\n';
        system += '## MCPs';
        for (const [id, mcp] of Object.entries(this.engine.mcps)) {
          if (mcp.isLoaded) {
            system += '\n';
            system += `- ${id}`;
          }
        }
      }
    } // mcps

    {
      // inject a compact catalog of loadable tools so the agent can discover and load them on demand via the load_tools
      system += '\n\n';
      system += '## Tools\n';

      // group internal tools
      const available = Object.values(this.engine.tools);
      const groups: Record<string, { name: string, info: string, args: string }[]> = {};
      for (const tool of available) {
        (groups[tool.meta.group] ||= []).push({ 
          name: tool.meta.function.name, 
          info: tool.meta.function.description, 
          args: Object.keys(tool.meta.function.parameters.properties).map(p => tool.meta.function.parameters.required?.includes(p) ? `?${p}` : p).join(',')
        });
      }

      // control tools first
      for (const [group, tools] of Object.entries(groups).filter(g => g[0] === 'control')) {
        system += `### ${group} tools:`;
        for (const { name, info, args } of tools) {
          system += '\n';
          system += `- \`${name}\`: ${info}\n`;
        }
      }

      // internal tools
      for (const [group, tools] of Object.entries(groups).filter(g => g[0] !== 'control')) {
        system += `### ${group} tools:`;
        for (const { name, info, args } of tools) {
          system += '\n';
          system += `- \`${name}\`: ${info}\n`;
        }
      }

      // mcp tools
      for (const [id, mcp] of Object.entries(this.engine.mcps)) {
        if (mcp.isLoaded) {
          system += `### ${id} MCP tools:`;
          for (const tool of Object.values(mcp.tools)) {
            system += '\n';
            system += `- \`${id}__${tool.name}\`: ${tool.description}`;
          }
        }
      }
    } // tools

    const chat = {} as Chat;
          chat.id =  chatId || '';
          chat.messages = [{ role: 'system', content: system }];
          chat.thinking = false;
          chat.userId = '';
          chat.tools = Object.values(this.engine.tools).filter(t => t.stop || t.meta.function.name === 'load_tools').map(t => t.meta);
          chat.updated = Date.now();

    return chat;
  }

  // save chat to cache (and persist it to ~/.marvin/chats/<chatId>.json)
  saveChat(chatId: string | undefined, chat: Chat): void {
    logger.debug('[Agent.saveChat]', `chatId=${chatId}`);

    if (!chatId) return;
    chat.updated = Date.now();
    this.cache[chatId] = chat;

    try {
      mkdirSync(join(this.engine.work, 'chats'), { recursive: true });
      writeFileSync(join(this.engine.work, 'chats', `${chatId}.json`), JSON.stringify(chat), 'utf-8');
    } catch (err) {
      logger.error('[Agent.saveChat]', 'failed to persist chat:', err);
    }
  }

  // pack chat history: collapse closed conversations, trim the active one when over cap
  packChat(chat: Chat): void {
    logger.debug('[Agent.packChat]', chat.id, chat.messages.length, 'messages');

    const messages = chat.messages;

    // split off the leading system message (always kept, never trimmed)
    const system = messages[0]?.role === 'system' ? messages[0] : undefined;
    const body = system ? messages.slice(1) : messages;

    // find the user messages that start each conversation
    const userIdx = body.reduce<number[]>((acc, m, i) => (m.role === 'user' ? [...acc, i] : acc), []);

    // stage 1: collapse every closed conversation (user .. just before the next user)
    // to its user message + last assistant reply, stripping tool calls and tool results
    const packed: Message[] = [];
    if (userIdx.length > 1) {
      for (let u = 0; u < userIdx.length - 1; u++) {
        // from #u user message to next user message
        const segment = body.slice(userIdx[u]!, userIdx[u + 1]!);
        // find the last assistant message in the segment
        const lastAssistant = [...segment].reverse().find((m) => m.role === 'assistant');
        // add user message
        packed.push(segment[0]!);
        // if there is an assistant message, add the rest
        if (lastAssistant) {
          const { tools, ...rest } = lastAssistant;
          packed.push(rest);
        }
      }
    }

    // active conversation: last user message + everything after it
    // (with a single conversation the whole body is active, leading messages included)
    const activeStart = userIdx.length > 1 ? userIdx[userIdx.length - 1]! : 0;
    let active = body.slice(activeStart);

    // stage 2: trim the active conversation only when the chat is at/over the cap,
    // removing the first assistant batch (assistant + its tool results) at a time
    while ((system ? 1 : 0) + active.length >= constants.MAX_CHAT_MESSAGES) {
      const firstAssistant = active.findIndex((m) => m.role === 'assistant');
      if (firstAssistant === -1) break;
      // the batch runs until the next assistant message (exclusive)
      let batchEnd = firstAssistant + 1;
      // find the next assistant message
      while (batchEnd < active.length && active[batchEnd]!.role !== 'assistant')
        batchEnd++;
      // never remove the last assistant batch: system + user + last exchange must survive
      if (active.slice(batchEnd).some((m) => m.role === 'assistant')) {
        // continue to reduce the active [] until there's no more assistant messages after
        active = [...active.slice(0, firstAssistant), ...active.slice(batchEnd)];
      } else {
        // is no more assistant messages after the batch, stop = found the last batch
        break;
      }
    }

    chat.messages = system ? [system, ...packed, ...active] : [...packed, ...active];

    // TODO
    // drop tool messages left without their assistant tool_calls parent right
    // after the trim point: APIs reject tool responses with no matching
    // tool_calls message before them
    // let keep = chat.messages[0]?.role === 'system' ? 1 : 0;
    // let scan = keep; // = 1
    // while (scan < chat.messages.length && chat.messages[scan]!.role === 'tool') scan++;
    // if (scan > keep) chat.messages = [...chat.messages.slice(0, keep), ...chat.messages.slice(scan)];
  }

  // tool call
  async execTool(tool: string, args: {[key:string]:any}, chat: Chat) : Promise<{[key:string]:any}> {
    logger.info('[Agent.execTool]', tool, JSON.stringify(args).slice(0, 128));
    try {
      // internal tools
      const instance = this.engine.tools[tool];
      if (instance) {
        // ! tool call
        return await instance.call(args, this, chat);
      }

      // mcp tools (<mcpId>__<toolName>) loaded per-task
      const split = splitToolName(tool);
      const mcp = split ? this.engine.mcps[split.id] : undefined;
      if (mcp) {
        return await mcp.call(split!.name, args);
      }
    } catch (err) {
      logger.warn('[Agent.execTool]', `failed=${tool} error=${(err as Error).message}`);
      return {tool: tool, error: (err as Error).message};
    }
    // not found
    logger.error('[Agent.execTool]', `tool ${tool} not found`);
    return {tool: tool, error: `tool ${tool} NOT found`};
  }

  // exec chat // agent loop
  async sendChat(chatId: string | undefined, message: string, onUpdate?: (update: string) => Promise<boolean>) : Promise<Result> {
    try {
      logger.info('[Agent.sendChat]', `chatId=${chatId} agent=${this.id}, message=${message.slice(0, 32)}`);

      // get chat from cache/store, or create a new one seeded with the system prompt
      const chat = this.loadChat(chatId);

      // load task input as user message
      chat.messages.push({ role: 'user', content: message.trim() });
      // send an update to the channel
      onUpdate?.(`\`${this.id}\` agent is thinking...`);

      // AI loop: call model, execute tool calls, repeat until done
      let reply: Reply;
      let steps = 0;
      let ended = false;
      let usage = chat.usage || 0;
      let content = '';
      do {
        steps++;

        // keep the chat history bounded (system message + last N messages)
        this.packChat(chat);

        // ! AI call // core of the AI loop: call model, execute tool calls, repeat until done
        reply = await this.model.execChat(chat);
        // trim content
        content = reply.message.content?.trim() || '';
        // count usage
        usage += reply.usage.completion + reply.usage.prompt;
        // send onUpdate to the channel
        onUpdate?.(`${content.slice(0, 64) || 'still thkinking...'}`);

        // persist assistant reply to chat history
        chat.messages.push({ role: 'assistant', content: content, tools: reply.message.tools });

        ended = reply.stop || ended;
        // execute any tool calls (engine tools, mcp __ tools via execTool)
        for (const call of reply.message.tools || []) {
          logger.debug('[Agent.sendChat]', `executing tool: ${call.name}`, JSON.stringify(call.arguments).slice(0, 64));
          const tool = this.engine.tools[call.name];
          if (tool?.stop) {
            ended = true;
            chat.messages.push({role: 'tool', content: JSON.stringify({ ended: true }), toolId: call.id});
            // send an update to the channel
            onUpdate?.(`  \`${call.name}\` - ending chat!`);
          } else if (ended) {
            // tools after end_chat / stop are skipped, but their ids still need an answer
            chat.messages.push({role: 'tool', content: JSON.stringify({ skipped: true }), toolId: call.id});
            // send an update to the channel
            onUpdate?.(`\`${call.name}\` - skipped!`);
          } else {
            // ! tool call - delegated to execTool which handles (engine and mcp) tools
            let result = await this.execTool(call.name, call.arguments, chat);
            let content = JSON.stringify(result);
            // add tool call to chat history, truncating huge results
            chat.messages.push({role: 'tool', content: content, toolId: call.id});
            // send an update to the channel
            onUpdate?.(`\`${call.name}\` - ${truncate(content, 64)}`);
          }
        }

        // trim result, this can be really big
        logger.debug('[Agent.sendChat]', `ended=${ended}`, `step=#${steps}`, `tools=${reply.message.tools?.map(t => t.name)}`);
      } while ((!ended) && (steps < constants.DEFAULT_MAX_STEPS));

      // warn if max steps reached
      if (steps >= constants.DEFAULT_MAX_STEPS) {
        logger.warn('[Agent.sendChat]', `max steps reached for ${this.id}`);
      }

      // track usage
      chat.usage = usage;

      // save chat to cache
      this.saveChat(chatId, chat);

      // done
      onUpdate?.(`\`${this.id}\` has finished!`);

      logger.debug('[Agent.sendChat]', `chatId=${chatId} agent=${this.id}, reply=${reply?.message?.content?.slice(0, 32)}`);
      return { content: (reply?.message?.content || '').trim(), steps: steps, usage: usage };
    } catch (err) {
      logger.error('[Agent.sendChat]', `chatId=${chatId} agent=${this.id}`, readError(err));
      return { content: '', steps: 0, error: (err as Error).message };
    } 
  }
}
