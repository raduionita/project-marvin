import { tryJsonParse } from '../helpers.js';
import { Chat, Model, Provider, Reply, Message } from '../types.js';

export default class DeepseekModel extends Model {
  provider: Provider = 'deepseek';
  public baseUrl: string = 'https://api.deepseek.com';

  async sendChat(chat: Chat) : Promise<Reply> {
    const body: { [key: string]: any } = {};

    body.model = this.model;
    body.messages = chat.messages.map(m => JSON.parse(JSON.stringify({
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
    })));

    body.stream = false;
    body.thinking = { type: (chat.thinking ? 'enabled' : 'disabled') };

    // user_id has a strict contract ([a-zA-Z0-9_-]{1,512}): only send it when present
    if (chat.userId) {
      body.user_id = chat.userId;
    }

    // reasoning_effort is only supported while thinking mode is enabled
    if (chat.thinking) {
      body.reasoning_effort = this.reasoning; // TODO: this should be configurable depending on the task
    }

    body.response_format = { type: chat.format === 'json' ? 'json_object' : 'text' };
    body.tools = chat.tools || this.tools;
    body.tool_choice = body?.length ? 'auto' : 'none';
    body.temperature = this.temperature;
    body.top_p = this.topP;
    body.max_tokens = this.maxTokens;

    this.logger.debug('[DeepseekModel.sendChat]', 'request', chat.id, chat.userId, chat.format);

    // call the model api
    const apiKey = this.apiKey || process.env.DEEPSEEK_API_KEY;
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    // check if response is ok
    if (!response.ok) {
      this.logger.error('[DeepseekModel.sendChat]', 'response NOT ok:', response);
      const body = await response.json();
      throw new Error(`[DeepseekModel.sendChat] ERROR ${body.error?.message || body.message || response.statusText}`);
    }

    // extract json from response
    const json = await response.json();

    // no choices, no reply
    if (!json.choices || json.choices.length === 0) {
      this.logger.warn('[DeepseekModel.sendChat]', 'no choices, no reply');
      return { id: json.id, stop: true, finish: 'empty', message: { role: 'assistant', content: '' } } as Reply;
    }

    // choice 0, for now only one choice is supported
    const choice = json.choices[0];
    // llm chat output as a reply object
    const reply = {
      id: json.id, // as string,
      // continue the AI loop only when the model wants to make tool calls;
      // stop/stop on 'length', 'content_filter', etc. too
      stop: choice.finish_reason !== 'tool_calls',
      finish: choice.finish_reason,
      message: {
        role: choice.message.role, // always "assistant" here
        content: choice.message.content,
        tools: choice.message.tool_calls?.map((t: {[key: string]: any}) => ({
          id: t.id,
          name: t.function.name,
          arguments: tryJsonParse(t.function.arguments),
        }))
        // TODO: research of reasoning_content may be needed?
      },
      usage: {
        completion: json.usage?.completion_tokens,
        prompt: json.usage?.prompt_tokens,
      }
    } as Reply;

    this.logger.debug('[DeepseekModel.sendChat]', 'response', json.id, choice.finish_reason, json.usage?.completion_tokens);

    return reply;
  }
}

