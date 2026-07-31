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
        properties: {},
        required: [],
      }
    },
  }

  async call(args?: any) {
    console.debug('[FinalAnswerTool.call]', args);
    return {};
  }
}
