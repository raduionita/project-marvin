import { Chat, Model, Provider } from '../types.js';

export default class DeepseekModel extends Model {
  provider: Provider = 'deepseek';
  public baseUrl: string = 'https://api.deepseek.com';

  async chat(chat: Chat): Promise<any> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: chat.messages,
        stream: false,
        thinking: chat.thinking,
      }),
    });

    const json = await response.json();
    return {
      id: json.id,
      usage: json.usage,
      message: {
        content: json.choices[0].message.content,
        tools: json.choices[0].message.tool_calls?.map((tool: {[key: string]: any}) => ({
          id: tool.id,
          name: tool.function.name,
          args: tool.function.arguments,
        })) ?? [],
      }
    };
  }
}
