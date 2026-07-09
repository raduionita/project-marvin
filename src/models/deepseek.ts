import { Chat, Model, Provider, Reply, Message } from '../types.js';

export default class DeepseekModel extends Model {
  provider: Provider = 'deepseek';
  public baseUrl: string = 'https://api.deepseek.com';

  async sendMessage(chat: Chat) : Promise<Reply> {
    console.log('[marvin]', 'DeepseekModel.sendMessage', 'chat:', JSON.stringify(chat));
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
        user_id: chat.userId,
        tool_choice: chat.tools ? 'auto' : 'none',
        reasoning_effort: this.reasoning, // TODO: this should be configurable depending on the task
        response_format: { type: this.format === 'json' ? 'json_object' : 'text' }, // TODO: this should be configurable depending on the task
        temperature: this.temperature,
        top_p: this.topP,
        max_tokens: this.maxTokens,
      }),
    });

    // extract json from response
    const json = await response.json();
    // quick stop
    const stop = json.choices.length === 0 || json.choices[0].finish_reason === 'stop';
    // choice 0, for now only one choice is supported
    const choice = json.choices[0];
    // llm chat output as a reply object
    return {
      id: json.id, // as string,
      stop: stop,
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

