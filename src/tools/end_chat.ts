import { Tool, ToolMeta } from "../types";
import * as constants from '../constants';

export default class EndChatTool extends Tool {
  public stop: boolean = true;

  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'end_chat',
      description: 'Call this tool ONLY when you have completed all necessary steps and are ready to give the final, definitive answer to the user.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      }
    },
  }

  async call(args?: any) {
    throw new Error('end_chat tool should never be called');
    return {};
  }
}
