import { Chat, Model, Provider } from '../types.js';

export default class AnthropicModel extends Model {
  provider: Provider = 'anthropic';
  public baseUrl: string = 'https://api.anthropic.com';

  async sendMessage(chat: Chat): Promise<any> {
    console.log('[AnthropicModel.chat]', 'chat:', JSON.stringify(chat));
    // call the model api
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        messages: chat.messages,
        stream: false,
      }),
    });

    const json = await response.json();
    const content = json.content?.[0];
    return {
      id: json.id,
      usage: {
        input_tokens: json.usage?.input_tokens,
        output_tokens: json.usage?.output_tokens,
      },
      message: {
        content: content?.text || '',
        tools: content?.type === 'tool_use' ? [{
          id: content.id,
          name: content.name,
          args: content.input,
        }] : [],
      }
    };
  }
}
