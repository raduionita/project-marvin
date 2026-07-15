import { Tool } from "../types";
import * as constants from '../constants';

export default class FinalAnswerTool extends Tool {
  meta = {
    type: 'function',
    function: {
      name: constants.FINAL_ANSWER_NAME,
      description: constants.FINAL_ANSWER_DESCRIPTION,
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
