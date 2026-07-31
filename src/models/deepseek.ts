import { Chat, Model, Provider, Reply, Message } from '../types.js';

export default class DeepseekModel extends Model {
  provider: Provider = 'deepseek';
  public baseUrl: string = 'https://api.deepseek.com';

  async sendMessage(chat: Chat) : Promise<Reply> {
    const body = {
      model: this.model,
      messages: chat.messages.map(m => JSON.parse(JSON.stringify({role: m.role, content: m.content, name: m.name, tool_call_id: m.toolId }))),
      stream: false,
      thinking: { type: (chat.thinking ? 'enabled' : 'disabled') },
      user_id: chat.userId,
      reasoning_effort: this.reasoning, // TODO: this should be configurable depending on the task
      response_format: { type: this.format === 'json' ? 'json_object' : 'text' }, // TODO: this should be configurable depending on the task
      tools: this.tools,
      tool_choice: this.tools ? 'auto' : 'none',
      temperature: this.temperature,
      top_p: this.topP,
      max_tokens: this.maxTokens,
    }

    console.debug('[DeepseekModel.sendMessage]', 'body:', JSON.stringify(chat, null, 2));

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
      console.error('[DeepseekModel.sendMessage]', 'response NOT ok:', response);
      const body = await response.json();
      throw new Error(`[DeepseekModel.sendMessage] ERROR ${body.error?.message || body.message || response.statusText}`);
    }

    // extract json from response
    const json = await response.json();

    // no choices, no reply
    if (!json.choices || json.choices.length === 0) {
      console.warn('[DeepseekModel.sendMessage]', 'no choices, no reply');
      return { id: json.id, stop: true, finish: 'empty', message: { role: 'assistant', content: '' } } as Reply;
    }

    console.debug('[DeepseekModel.sendMessage]', 'json', JSON.stringify(json, null, 2));

    // choice 0, for now only one choice is supported
    const choice = json.choices[0];
    // llm chat output as a reply object
    return {
      id: json.id, // as string,
      stop: json.choices[0].finish_reason === 'stop',
      finish: json.finish_reason,
      message: {
        role: choice.message.role, // always "assistant" here
        content: choice.message.content,
        tools: choice.message.tool_calls?.map((tool: {[key: string]: any}) => ({
          id: tool.id,
          name: tool.function.name,
          arguments: tool.function.arguments,
        }))
        // TODO: research of reasoning_content may be needed?
      },
      usage: {
        completion: json.usage?.completion_tokens,
        prompt: json.usage?.prompt_tokens,
      }
    } as Reply;
  }
}

