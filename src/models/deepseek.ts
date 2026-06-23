import { Model } from '../types.js';

export default class DeepseekModel extends Model {
  async chat(chat: any) {
    console.log('[Deepseek] Received chat:', JSON.stringify(chat, null, 2));
    return {
      role: 'assistant',
      content: 'Hello from Deepseek!'
    };
  }
}
