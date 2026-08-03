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

    if (this.engine.isDry) {
      console.info('[WebBrowseTool.call]', '[dry] browse:', args.url);
      return { title: '', body: '', error: '' };
    }

    if (!this.engine.systems['browser']) {
      return { title:'', body:'', error: 'webBrowse: Browser is not loaded in the server engine' }
    }

    const system = this.engine.systems['browser'] as BrowserSystem;
    const url = args.url;

    const page = await system.newPage();
    page.setDefaultNavigationTimeout(15_000);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 });
      const title = await page.title();
      await page.$eval('header, footer, script, iframe', el => el.remove());
      const text = await page.$eval('body', el => el.innerText);
      return { title, body: text.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0).join('\n') };
    } catch (error) {
      console.error('[WebBrowseTool.call]', 'error:', error);
    } finally {
      await page.close();
    }
    return { title: '', body: '', error: 'webBrowse: error' };
  }
}
