import { Tool, ToolMeta } from "../types";
import * as constants from '../constants';

export default class EndChatTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: constants.END_CHAT_NAME,
      description: constants.END_CHAT_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            description: 'Final answer',
          }
        },
        required: ['answer'],
      }
    },
  }

  async call(args: { answer: string }) {
    console.debug('[FinalAnswerTool.call]', args);
    return {answer: args.answer};
  }
}
