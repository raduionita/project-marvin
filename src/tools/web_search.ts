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
    console.debug('[WebSearchTool.call]', args);

    if (this.ctx.isDry) {
      console.info('[WebSearchTool.call]', '[dry] search:', args.query);
      return { results: [] };
    }

    if (!this.ctx.systems['browser']) {
      throw new Error('[WebSearchTool.call] ERROR - Browser is not initialized in the server context');
    }

    const system = this.ctx.systems['browser'] as BrowserSystem;
    const query = args.query;
    const url = `https://duckduckgo.com?q=${query}&df=d`;


    const page = await system.newPage();
    page.setDefaultNavigationTimeout(15_000);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 });
      await delay(rand(500, 1000));

      const script = await page.waitForResponse((response) => response.url().includes('links.duckduckgo.com/d.js'), { timeout: 5_000 });
      const text = await script.text();

      const start = text.indexOf(SEARCH_START_TAG);
      const end = text.indexOf(SEARCH_END_TAG, start);
      const raw = text.substring(start + SEARCH_START_TAG.length, end);
      const json: any[] = tryJsonParse(raw) || [];
      json.length = Math.min(json.length, 10);

      return { results: json.map((o: { [key: string]: any }) => ({
        title: o.t.replace(/<\/?[^>]+(>|$)/g, ''),
        body: o.a.replace(/<\/?[^>]+(>|$)/g, ''),
        link: o.c
      })) };
    } catch (error) {
      console.error('[WebSearchTool.call]', 'error:', error);
    } finally {
      await page.close();
    }
    return { results: [] };
  }
}
