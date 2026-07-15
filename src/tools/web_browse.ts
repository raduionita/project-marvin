import { Tool, type ToolMeta } from '../types.js';
import type BrowserSystem from '../systems/browser.js';

export default class WebBrowseTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'web_browse',
      description: 'Browse the web',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to browse',
          }
        },
        required: ['url'],
      }
    },
  }

  public async call(args: { url: string }) {
    console.debug('[WebBrowseTool.call]', args);

    if (this.ctx.isDry) {
      console.info('[dry] browse:', args.url);
      return { title: '', body: '' };
    }

    if (!this.ctx.systems['browser']) {
      throw new Error('webBrowse: Browser is not initialized in the server context');
    }

    const system = this.ctx.systems['browser'] as BrowserSystem;
    const url = args.url;
    const bctx = await system.newContext({
      viewport: { width: 1200, height: 800 },
      javaScriptEnabled: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.56 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      bypassCSP: true,
    });

    await bctx.route('**/*', (route) => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        return route.continue();
      } else {
        return route.abort();
      }
    });

    const page = await bctx.newPage();
    page.setDefaultNavigationTimeout(15_000);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 });
      const title = await page.title();
      const body = page.locator('body');
      await body.locator('header, footer, script, iframe').evaluateAll((nodes: HTMLElement[]) => {
        for (const n of nodes) n.remove();
      });
      const text = await body.innerText();
      return { title, body: text.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0).join('\n') };
    } catch (error) {
      console.error('webBrowse', 'error:', error);
      throw error;
    } finally {
      await page.close();
      await bctx.close();
    }
  }
}
