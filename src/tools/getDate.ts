import { Tool } from '../types.js';

export default class GetDateTool extends Tool {
  name() { return 'getDate'; }
  info() { return 'Get the current date'; }
  args() {
    return {
      timestamp: {
        type: 'number',
        description: 'Optional timestamp',
        required: false,
      }
    };
  }

  async call(args: any) {
    console.debug('[GetDateTool.call]', args);
    
    return new Date(args.timestamp || Date.now()).toLocaleDateString();
  }
}
