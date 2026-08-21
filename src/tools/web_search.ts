import { Tool } from '../types.js';
import type { ToolMeta } from '../types.js';
import { delay, rand, tryJsonParse } from '../helpers.js';
import type BrowserSystem from '../systems/browser.js';

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

  public async call(args: { query: string }) {
    this.logger.debug('[WebSearchTool.call]', JSON.stringify(args));

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
      const raw = text.substring(start + SEARCH_START_TAG.length, end);
      const json: any[] = tryJsonParse(raw) || [];
      json.length = Math.min(json.length, 10);

      return { 
        results: json.map((o: { [key: string]: any }) => ({
          title: o.t.replace(/<\/?[^>]+(>|$)/g, ''),
          body: o.a.replace(/<\/?[^>]+(>|$)/g, ''),
          link: o.c
        })),
      };
    } catch (error) {
      // distinguish "search failed" from "no results", so the LLM does not
      // conclude nothing exists when the scrape/parse simply failed
      this.logger.error('[WebSearchTool.call]', 'error:', error);
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
