import { Chat, Model, Provider } from '../types.js';

export class LmstudioModel extends Model {
  provider: Provider = 'lmstudio';
  public baseUrl: string = 'http://localhost:1234';

  async execChat(chat: Chat) : Promise<any> {
    this.logger.debug('[LmstudioModel.sendChat]', 'chat:', JSON.stringify(chat));

    // role: system, user, assistant

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        temperature: 0.7,
        top_p: 0.9,
        reasoning_effort: "high",
        thinking: { type: (chat.thinking ? 'enabled' : 'disabled') },
        max_tokens: 8192,
        n: 1,
        // user_id: "user-id",
        // tool_choice: "auto",
        ...(chat.format === 'json' ? { response_format: { type: "json_object" } } : {}),
        tools: [
          {
            type: "function",
            description: "Useful for when you need to answer questions about current events.",
            name: "current_events",
            // strict: true, // beta
            parameters: {
              type: "object",
              properties: {
                "location:": { "type": "string", "description": "The location you want to know about." },
              },
            },
            required: ["location"],
          }
        ],
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: prompt, name: 'user' },
          { role: 'assistant', content: '' },
          { role: 'tool', content: 'content of the tool message', tool_call_id: 'Tool call that this message is responding to.'},
        ],
      }),
    });

    const json = await response.json();
    return {
      id: json.id,
      usage: json.usage,
      message: {
        content: json.choices[0].message.content,
        tools: json.choices[0].message.tool_calls.map((tool:{[key:string]:any}) => ({ id:tool.id, name:tool.function.name, args:tool.function.arguments })),
      }
    }
  }
}
