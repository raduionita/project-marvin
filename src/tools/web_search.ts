import { Tool } from '../types.js';
import type { ToolMeta } from '../types.js';
import { delay, rand, readError, tryJsonParse } from '../helpers.js';
import type BrowserSystem from '../systems/browser.js';
import TurndownService from 'turndown';
import Engine from '../engine.js';
import { Logger } from '../logger.js';

const SEARCH_START_TAG = "DDG.pageLayout.load('d',";
const SEARCH_END_TAG = ");DDG.duckbar.loadModule";

export default class WebSearchTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          }
        },
        required: ['query'],
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

  public async call(args: { query: string }) {
    this.logger.debug('[WebSearchTool.call]', Object.keys(args));

    if (this.engine.isDry) {
      this.logger.info('[WebSearchTool.call]', '[dry] search:', args.query);
      return { results: [] };
    }

    if (!this.engine.systems['browser']) {
      throw new Error('[WebSearchTool.call] ERROR - Browser is not loaded in the server engine');
    }

    const system = this.engine.systems['browser'] as BrowserSystem;
    const query = args.query;
    const url = `https://duckduckgo.com?q=${query}&df=d&kp=-1&kc=-1&kz=-1&kl=wt-wt`;

    let page: Awaited<ReturnType<BrowserSystem['newPage']>> | undefined;
    let raw: string | undefined;
    try {
      page = await system.newPage((request) => {
        // exlude everything except links.duckduckgo.com/d.js and document
        const type = request.resourceType();
        const url = request.url();
        if (type === 'script' && !url.includes('links.duckduckgo.com/d.js')) {
          // this.logger.debug('[WebSearchTool.newPage]', 'blocking', type, url);
          return request.abort();
        } else if (['image', 'stylesheet', 'font', 'media', 'other', 'manifest', 'xhr'].includes(type)) {
          // this.logger.debug('[WebSearchTool.newPage]', 'blocking', type, url);
          return request.abort();
        } else {
          this.logger.debug('[WebSearchTool.newPage]', 'allowing', type, url);
          return request.continue();
        }
      });
      page.setDefaultNavigationTimeout(15_000);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 });

      // after the html/doc is loaded, duck requests d.js that contains the search results
      const script = await page.waitForResponse((response) => response.url().includes('links.duckduckgo.com/d.js'), { timeout: 10_000 });
      const text = await script.text();

      // done with the page
      await page.close();

      // the results need to be extracted/parsed
      const start = text.indexOf(SEARCH_START_TAG);
      const end = text.indexOf(SEARCH_END_TAG, start);
            raw = text.substring(start + SEARCH_START_TAG.length, end);
      const json: any[] = tryJsonParse(raw) || [];
            json.length = Math.min(json.length, 10);
      return { 
        results: json.map((o: { [key: string]: any }) => ({
          title: this.turndown.turndown(o.t || ''),
          body: this.turndown.turndown(o.a || ''),
          link: o.c || '',
        })),
      };
    } catch (error) {
      // distinguish "search failed" from "no results", so the LLM does not
      // conclude nothing exists when the scrape/parse simply failed
      this.logger.error('[WebSearchTool.call]', 'error:', readError(error), 'url:', url, 'query:', query, 'raw:', raw?.substring(0,100));
      return { 
        results: [], 
        error: `web_search failed: ${(error as Error).message}` 
      };
    } finally {
      this.logger.debug('[WebSearchTool.call]', 'closing page');
      if (page && !page.isClosed()) {
        await page.close();
      }
    }
  }
}
