import { Tool, ToolMeta } from '../types.js';

export default class GetDateTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'get_date',
      description: 'Get the current date',
      parameters: {
        type: 'object',
        properties: {
          timestamp: {
            type: 'number', // object, string, number,integer, boolean, array, enum, anyOf
            description: 'Optional timestamp',
          }
        },
        required: [],
      }
    },
  }

  public async call(args: {timestamp?:number}) {
    this.logger.debug('[GetDateTool.call]', args);
    
    return {date: new Date(args.timestamp || Date.now()).toDateString()};
  }
}
