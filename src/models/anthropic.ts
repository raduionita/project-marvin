import { withRetry, HttpError } from '../helpers/index.js';
import { Chat, Model, Provider, Reply } from '../types.js';
import type Engine from '../engine.js';
import * as constants from '../constants.js';
import logger from '../logger.js';

export default class AnthropicModel extends Model {
  // `declare` emits no defines, so config values (via super()) survive;
  // defaults are applied at the end of the constructor instead
  declare public provider: Provider;
  declare public baseUrl: string;
  // timeout for a single chat completion request (overridable per model config).
  declare public timeoutMs: number;

  constructor(engine: Engine, config: { [key: string]: any } = {}) {
    super(engine, config);
    this.provider = config.provider || 'anthropic';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    this.timeoutMs ??= constants.MODEL_CALL_TIMEOUT_MS;
  }

  async sendChat(chat: Chat): Promise<Reply> {
    logger.debug('[AnthropicModel.sendChat]', 'chat:', JSON.stringify(chat));

    const body: { [key: string]: any } = {
      model: this.model,
      max_tokens: this.maxTokens,
      stream: false,
      // rebuild the block-based content Anthropic expects: assistant messages
      // that carried tool calls are split into text + tool_use blocks, and
      // tool results become user messages with a tool_result block
      messages: chat.messages.map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.toolId, content: m.content }],
          };
        }
        if (m.tools?.length) {
          return {
            role: m.role,
            content: [
              { type: 'text', text: m.content || '' },
              ...m.tools.map(t => ({ type: 'tool_use', id: t.id, name: t.name, input: t.arguments })),
            ],
          };
        }
        return { role: m.role, content: m.content };
      }),
    };

    // the engine snapshots the tools for this chat (agent tools + any
    // per-task deliverable tool); falls back to the model's own snapshot
    const tools = chat.tools;
    if (tools?.length) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    // ! call the model api, with a timeout and retries on transient failures
    const response = await withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      // check if response is ok
      if (!res.ok) {
        logger.error('[AnthropicModel.sendChat]', 'response NOT ok:', res.status);
        const errBody = await res.json().catch(() => ({}));
        throw new HttpError(res.status, `[AnthropicModel.sendChat] ERROR ${errBody?.error?.message || errBody?.message || res.statusText}`);
      }

      return res;
    }, {
      retries: constants.MODEL_CALL_RETRIES,
      // retry network errors, timeouts, 429 and 5xx; not other client errors
      shouldRetry: (err) => err instanceof HttpError ? (err.status === 429 || err.status >= 500) : true,
    });

    const json = await response.json();

    // no content blocks, no reply
    if (!json.content || json.content.length === 0) {
      logger.warn('[AnthropicModel.sendChat]', 'no content, no reply');
      return { id: json.id, stop: true, finish: 'empty', message: { role: 'assistant', content: '' } } as Reply;
    }

    // a message may mix text blocks (markdown) and tool_use blocks: collect
    // all of them so the markdown answer is never dropped
    const blocks = json.content as { type: string; text?: string; id?: string; name?: string; input?: any }[];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('');
    const toolUses = blocks.filter(b => b.type === 'tool_use');

    return {
      id: json.id,
      stop: toolUses.length === 0,
      finish: toolUses.length ? 'tool_calls' : (json.stop_reason || 'stop'),
      message: {
        role: 'assistant',
        content: text,
        tools: toolUses.map(b => ({ id: b.id!, name: b.name!, arguments: b.input })),
      },
      usage: {
        completion: json.usage?.output_tokens,
        prompt: json.usage?.input_tokens,
      },
    } as Reply;
  }
}
