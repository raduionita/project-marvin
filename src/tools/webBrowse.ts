import { Tool } from '../types.js';
import type { Context } from '../context.js';

export default class WebBrowseTool extends Tool {
  name() { return 'webBrowse'; }
  description() { return 'Browse the web'; }
  args() {
    return {
      url: {
        type: 'string',
        description: 'URL to browse',
        required: true,
      }
    };
  }

  async call(ctx: Context, args: { url: string }) {
    if (!ctx.browser) {
      throw new Error('Browser is not initialized in the server context');
    }

    const url = args.url;
    const browserCtx = await ctx.browser.newContext({
      viewport: { width: 1200, height: 800 },
      javaScriptEnabled: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.56 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      bypassCSP: true,
    });

    await browserCtx.route('**/*', (route) => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        return route.continue();
      } else {
        return route.abort();
      }
    });

    const page = await browserCtx.newPage();
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
      console.error('[Tool: webBrowse] Error:', error);
      throw error;
    } finally {
      await page.close();
      await browserCtx.close();
    }
  }
}
