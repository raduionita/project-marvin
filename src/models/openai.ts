import { Chat, Model, Provider } from '../types.js';

export class OpenaiModel extends Model {
  provider: Provider = 'openai';
  public baseUrl: string = 'https://api.openai.com';

  async sendMessage(chat: Chat): Promise<any> {
    console.log('OpenaiModel.chat', 'chat:', JSON.stringify(chat));
    // call the model api
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
