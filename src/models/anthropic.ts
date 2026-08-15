import { Chat, Model, Provider, Reply } from '../types.js';

export default class AnthropicModel extends Model {
  provider: Provider = 'anthropic';
  public baseUrl: string = 'https://api.anthropic.com';

  async sendChat(chat: Chat): Promise<Reply> {
    this.logger.debug('[AnthropicModel.sendChat]', 'chat:', JSON.stringify(chat));

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
    const tools = chat.tools || this.tools;
    if (tools?.length) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    // call the model api
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    // check if response is ok
    if (!response.ok) {
      this.logger.error('[AnthropicModel.sendChat]', 'response NOT ok:', response);
      const errBody = await response.json();
      throw new Error(`[AnthropicModel.sendChat] ERROR ${errBody?.error?.message || errBody?.message || response.statusText}`);
    }

    const json = await response.json();

    // no content blocks, no reply
    if (!json.content || json.content.length === 0) {
      this.logger.warn('[AnthropicModel.sendChat]', 'no content, no reply');
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
