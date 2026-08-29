import TurndownService from 'turndown';

import { Tool, type ToolMeta } from '../types.js';
import type BrowserSystem from '../systems/browser.js';
import type Engine from '../engine.js';
import { type Logger } from '../logger.js';
import * as constants from '../constants.js';
import { readError } from '../helpers.js';

export default class WebBrowseTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'web',
    function: {
      name: 'web_browse',
      description: 'Browse the web',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to browse',
          },
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
    this.logger.debug('[WebBrowseTool.call]', Object.keys(args));

    if (!this.engine.systems['browser']) {
      return { title:'', body:'', error: 'webBrowse: Browser is not loaded in the server engine' }
    }

    const system = this.engine.systems['browser'] as BrowserSystem;
    const url = args.url;

    const page = await system.newPage();
    page.setDefaultNavigationTimeout(15_000);

    let error = '';
    let title = '';
    let body  = '';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 });
      body = await page.evaluate(function () {
        const body = document.querySelector('body');
        if (!body) return '';
        return body.innerHTML;
      });
      // output
      title = await page.title();
      body  = this.turndown.turndown(body).slice(0, constants.MAX_TOOL_RESULT_CHARS - 8);
    } catch (error) {
      this.logger.error('[WebBrowseTool.call]', 'error:', readError(error), 'url:', url);
      title = 'error';
      error = 'web_browse: error';
    } finally {
      await page.close();
    }

    return { 
      title: title,
      body: body,
      error: error,
    };
  }
}
