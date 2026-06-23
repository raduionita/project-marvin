import { Tool } from '../types.js';
import type { Context } from '../context.js';
import { delay, rand, tryJsonParse } from '../helpers.js';

const SEARCH_START_TAG = "DDG.pageLayout.load('d',";
const SEARCH_END_TAG = ");DDG.duckbar.loadModule";

export default class WebSearchTool extends Tool {
  name() { return 'webSearch'; }
  description() { return 'Search the web'; }
  args() {
    return {
      query: {
        type: 'string',
        description: 'Search query',
        required: true,
      }
    };
  }

  async call(ctx: Context, args: { query: string }) {
    if (!ctx.browser) {
      throw new Error('webSearch: Browser is not initialized in the server context');
    }

    const query = args.query;
    const url = `https://duckduckgo.com?q=${query}&df=d`;
    const browserCtx = await ctx.browser.newContext({
      viewport: { width: 1200, height: 800 },
      javaScriptEnabled: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.56 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      bypassCSP: true,
    });

    await browserCtx.route('**/*', (route) => {
      const request = route.request();
      if (request.url().includes('links.duckduckgo.com/d.js') || request.isNavigationRequest()) {
        return route.continue();
      } else {
        return route.abort();
      }
    });

    const page = await browserCtx.newPage();
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
      console.error('[marvin]', 'webSearch', 'error:', error);
    } finally {
      await page.close();
      await browserCtx.close();
    }

    return { results: [] };
  }
}
