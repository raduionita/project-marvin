
import { Tool, type ToolMeta } from '../types.js';

export default class WebFetchTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a web page and extract the content',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to fetch',
          }
        },
        required: ['url'],
      }
    },
  }

  public async call(args: { url: string }) {
    this.logger.debug('[WebFetchTool.call]', JSON.stringify(args));

    if (this.engine.isDry) {
      this.logger.info('[WebFetchTool.call]', '[dry] fetch:', args.url);
      return { results: [] };
    }

    // use fetch to fetch the page
    const response = await fetch(args.url);
    const text = await response.text();

    // extract the relevant content
    const start = text.indexOf('<body>');
    const end = text.indexOf('</body>');
    const body = text.substring(start + 6, end);

    return { result: body };
  }
}
