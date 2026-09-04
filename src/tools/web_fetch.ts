
import TurndownService from 'turndown';
import { XMLParser } from "fast-xml-parser";

import { Tool, type ToolMeta } from '../types.js';
import type Engine from '../engine.js';
import * as constants from '../constants.js';
import logger from '../logger.js';
import { stripTags } from '../helpers/index.js';

export default class WebFetchTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'web',
    function: {
      name: 'web_fetch',
      description: 'Fetch content of a web page, API or RSS feed. If blocked, fails, or empty, try `web_browse`.',
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

  constructor(engine: Engine) {
    super(engine);
    this.turndown.remove([
      'script',
      'style',
      'head',
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
      'map', 'area',
      'template',
      'dialog',
    ]);
  }

  public async call(args: { url: string }) {
    logger.debug('[WebFetchTool.call]', args.url.slice('https://'.length, 64));

    const response = await fetch(args.url);
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    let result: string;

    if (contentType.includes('text/html')) {
      result = this.turndown.turndown(text);
    } else if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(text);
        result = JSON.stringify(parsed, null, 2);
      } catch {
        result = text;
      }
    } else if (contentType.includes('rss+xml') || contentType.includes('xml')) {
      const limit = 10;
      const parser = new XMLParser();
      const doc = parser.parse(text);

      // navigate to channel items (RSS 2.0) or feed entries (Atom)
      const channel = doc?.rss?.channel || doc?.feed;
      const rawItems = channel?.item || channel?.entry || [];
      const items: Record<string, string>[] = Array.isArray(rawItems) ? rawItems : [rawItems];

      const lines = items.slice(0, limit).map((item) => {
        const title = item.title || '';
        const rawLink = item.link;
        const link = typeof rawLink === 'object' ? rawLink['@_href'] || '' : rawLink || '';
        const description = stripTags(item.description || item.summary || item.content || '');
        return `## ${title}\n${link}\n${description}`;
      });

      result = lines.join('\n\n');
    } else {
      // text/plain and anything else
      result = text;
    }

    return { 
      result: result.slice(0, constants.MAX_TOOL_RESULT_CHARS),
    };
  }
}
