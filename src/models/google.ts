import { withRetry, HttpError } from '../helpers/index.js';
import { Chat, Model, Provider, Reply } from '../types.js';
import type Engine from '../engine.js';
import * as constants from '../constants.js';
import logger from '../logger.js';

export default class GoogleModel extends Model {
  provider: Provider = 'google';
  public baseUrl: string = 'https://generativelanguage.googleapis.com';
  // timeout for a single chat completion request (overridable per model config).
  // `declare` emits no define, so a value from config (via super()) survives.
  declare public timeoutMs: number;

  constructor(engine: Engine, config: { [key: string]: any } = {}) {
    super(engine, config);
    // field initializers run after super(), so the default goes last
    this.timeoutMs ??= constants.MODEL_CALL_TIMEOUT_MS;
  }

  async sendChat(chat: Chat): Promise<Reply> {
    logger.debug('[GoogleModel.sendChat]', '-->', `id=${chat.id} userId=${chat.userId}`);

    // system messages become a systemInstruction; everything else becomes contents
    const systemTexts = chat.messages
      .filter(m => m.role === 'system')
      .map(m => m.content);
    const contents = chat.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            parts: [{
              functionResponse: {
                // toolId carries the functionCall id; fall back to the tool name
                name: m.tools?.[0]?.name || 'tool',
                response: { output: m.content },
              },
            }],
          };
        }
        const parts: { [key: string]: any }[] = [{ text: m.content || '' }];
        for (const t of m.tools || []) {
          parts.push({ functionCall: { name: t.name, args: t.arguments } });
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts };
      });

    const body: { [key: string]: any } = {
      contents,
      generationConfig: {
        temperature: this.temperature,
        topP: this.topP,
        maxOutputTokens: this.maxTokens,
      },
    };
    if (systemTexts.length) {
      body.systemInstruction = { parts: systemTexts.map(text => ({ text })) };
    }
    if (chat.tools?.length) {
      body.tools = [{
        functionDeclarations: chat.tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
      body.toolConfig = {
        functionCallingConfig: { mode: 'AUTO' },
      };
    } else {
      body.toolConfig = {
        functionCallingConfig: { mode: 'NONE' },
      };
    }

    // ! call the model api, with a timeout and retries on transient failures
    const response = await withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/v1beta/models/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey || process.env.GOOGLE_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        logger.error('[GoogleModel.sendChat]', 'response NOT ok:', res.status);
        const errBody = await res.json().catch(() => ({}));
        throw new HttpError(res.status, `[GoogleModel.sendChat] ERROR ${errBody?.error?.message || errBody?.message || res.statusText}`);
      }

      return res;
    }, {
      retries: constants.MODEL_CALL_RETRIES,
      // retry network errors, timeouts, 429 and 5xx; not other client errors
      shouldRetry: (err) => err instanceof HttpError ? (err.status === 429 || err.status >= 500) : true,
    });

    const json = await response.json();
    const candidate = json.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      logger.warn('[GoogleModel.sendChat]', 'no candidates, no reply');
      return { id: json.id || String(Date.now()), stop: true, finish: 'empty', message: { role: 'assistant', content: '' } } as Reply;
    }

    const parts = candidate.content.parts as { text?: string; functionCall?: { name: string; args: any } }[];
    const text = parts.filter(p => typeof p.text === 'string').map(p => p.text as string).join('');
    const calls = parts.filter(p => p.functionCall).map((p, i) => ({
      id: `call_${i}`,
      name: p.functionCall!.name,
      arguments: p.functionCall!.args || {},
    }));

    const reply = {
      id: json.id || candidate.id || String(Date.now()),
      stop: calls.length === 0,
      finish: calls.length ? 'tool_calls' : (candidate.finishReason || 'stop'),
      message: {
        role: 'assistant',
        content: text.trim(),
        tools: calls.length ? calls : undefined,
      },
      usage: {
        completion: json.usageMetadata?.candidatesTokenCount,
        prompt: json.usageMetadata?.promptTokenCount,
      },
    } as Reply;

    logger.debug('[GoogleModel.sendChat]', '<--', `id=${reply.id}`);
    return reply;
  }
}
