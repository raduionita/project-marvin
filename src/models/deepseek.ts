import { Model, Chat, Provider } from '../types.js';

export default class DeepseekModel extends Model {
  provider: Provider = 'deepseek';
  public baseUrl: string = 'https://api.deepseek.com';

  // sends messages to deepseek LLM model through API
  async chat(chat: Chat) : Promise<any> {
    console.log('[marvin]', 'DeepseekModel.chat', 'chat:', JSON.stringify(chat));
    // mock, TODO: implement
    return {
      role: 'assistant',
      content: 'Hello from Deepseek!'
    };
  }
}
