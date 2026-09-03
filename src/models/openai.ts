import { tryJsonParse } from '../helpers/index.js';
import { Chat, Model, Provider, Reply } from '../types.js';
import logger from '../logger.js';

export class OpenaiModel extends Model {
  provider: Provider = 'openai';
  public baseUrl: string = 'https://api.openai.com';

  async execChat(chat: Chat): Promise<Reply> {
    logger.debug('[OpenaiModel.sendChat]', 'chat:', JSON.stringify(chat));

    const body: { [key: string]: any } = {
      model: this.model,
      messages: chat.messages.map(m => JSON.parse(JSON.stringify({
        role: m.role,
        content: m.content,
        name: m.name,
        tool_call_id: m.toolId,
        tool_calls: m.tools?.map(t => ({
          id: t.id,
          type: 'function',
          function: {
            name: t.name,
            arguments: JSON.stringify(t.arguments),
          },
        })),
      }))),
      stream: false,
    };

    // the engine snapshots the tools for this chat (agent tools + any
    // per-task deliverable tool); falls back to the model's own snapshot
    const tools = chat.tools;
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    // call the model api
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    // check if response is ok
    if (!response.ok) {
      logger.error('[OpenaiModel.sendChat]', 'response NOT ok:', response);
      const errBody = await response.json();
      throw new Error(`[OpenaiModel.sendChat] ERROR ${errBody?.error?.message || errBody?.message || response.statusText}`);
    }

    const json = await response.json();

    // no choices, no reply
    if (!json.choices || json.choices.length === 0) {
      logger.warn('[OpenaiModel.sendChat]', 'no choices, no reply');
      return { id: json.id, stop: true, finish: 'empty', message: { role: 'assistant', content: '' } } as Reply;
    }

    const choice = json.choices[0];
    return {
      id: json.id,
      // continue the AI loop only when the model wants to make tool calls
      stop: choice.finish_reason !== 'tool_calls',
      finish: choice.finish_reason,
      message: {
        role: choice.message.role || 'assistant',
        content: choice.message.content,
        tools: choice.message.tool_calls?.map((t: { [key: string]: any }) => ({
          id: t.id,
          name: t.function.name,
          // arguments arrive as a JSON string from the OpenAI API
          arguments: tryJsonParse(t.function.arguments) || {},
        })),
      },
      usage: {
        completion: json.usage?.completion_tokens,
        prompt: json.usage?.prompt_tokens,
      },
    } as Reply;
  }
}

export default OpenaiModel;
