import { Chat, Model, Provider, Reply, Message } from '../types.js';

export default class FallbackModel extends Model {
  provider: Provider = 'fallback';
  public baseUrl: string = 'http://localhost:1234';

  async execChat(chat: Chat) : Promise<Reply> {
    this.logger.debug('[FallbackModel.sendChat]', 'chat:', JSON.stringify(chat));

    return {
      id: Date.now().toString(),
      stop: true,
      finish: 'fallback',
      message: {
        role: 'assistant',
        content: '(fallback model)',
      },
      usage: {
        completion: 0,
        prompt: 0,
      }
    } as Reply;
  }
}
