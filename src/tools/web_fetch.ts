
import TurndownService from 'turndown';

import { Tool, type ToolMeta } from '../types.js';
import type Engine from '../engine.js';
import { type Logger } from '../logger.js';
import * as constants from '../constants.js';


export default class WebFetchTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'web',
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

  private turndown: TurndownService = new TurndownService({ headingStyle: 'atx', hr: '---', codeBlockStyle: 'fenced' });

  constructor(engine: Engine, logger: Logger) {
    super(engine, logger);
    this.turndown.remove([
      'script',
      'style',
      'aside',
      'nav',
      'footer',
      'iframe',
      'noscript',
      'meta',
      'link',
      'button',
      'canvas',
      'audio',
      'video',
      'source',
      'track',
      'embed',
      'object',
      'picture',
      'colgroup',
      'form', 'input', 'select', 'textarea', 'optgroup', 'option', 'label', 'fieldset',
      'head',
      'map', 'area',
      'template',
      'dialog',
    ]);
  }

  public async call(args: { url: string }) {
    this.logger.debug('[WebFetchTool.call]', Object.keys(args));

    // use fetch to fetch the page
    const response = await fetch(args.url);
    const html = await response.text();
    
    // extract the relevant content
    // const body = html.substring(html.search(/\<body.+\>/) + 6, html.search(/\<\/body\>/i))
    // const title = html.substring(html.indexOf('<title>') + 7, html.indexOf('</title>'));

    return { 
      result: this.turndown.turndown(html).slice(0, constants.MAX_TOOL_RESULT_CHARS - 8),
    };
  }
}
