import puppeteer from 'puppeteer-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext, BrowserContextOptions, Page } from 'puppeteer';

import { System } from '../types.js';

export default class BrowserSystem extends System {
  private browser: Browser | undefined;
  private bctx: BrowserContext | undefined;

  public async load(): Promise<void> {
    console.log('[BrowserSystem.load]');

    if (this.ctx.isDry) {
      console.log('[BrowserSystem.load]', '[dry] loading chromium');
      return;
    }
    
    puppeteer.use(stealth());

    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding'
      ],
      // todo: proxies
    });
  }

  public async drop(): Promise<void> {
    console.debug('[BrowserSystem.drop]');
    if (this.browser) {
      try {
        await this.browser.close();
        console.log('[BrowserSystem.drop]', 'closed');
      } catch (err) {
        console.error('[BrowserSystem.drop]', 'error:', err);
      }
      this.browser = undefined;
    } else {
      console.log('[BrowserSystem.drop]', 'already closed');
    }
  }

  public async newPage() : Promise<Page> {
    if (!this.browser) {
      console.error('[BrowserSystem.newPage]', 'browser not loaded');
      throw new Error('[BrowserSystem.newPage] ERROR - browser not loaded');
    }
    if (!this.bctx) {
      console.error('[BrowserSystem.newPage]', 'browser context not loaded');
      throw new Error('[BrowserSystem.newPage] ERROR - browser context not loaded');
    }

    const page = await this.bctx.newPage();

    page.setViewport({ width: 1200, height: 800 });
    page.setJavaScriptEnabled(true);
    page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.56 Safari/537.36');
    page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    page.setBypassCSP(true);

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.isInterceptResolutionHandled()) return;
      // request.url().includes('links.duckduckgo.com/d.js') || 
      if (request.isNavigationRequest()) {
        return request.continue();
      } else {
        return request.abort();
      }
    });

    return page;
  }

  public async newContext(options?: BrowserContextOptions) : Promise<BrowserContext> {
    if (!this.browser) {
      console.error('[BrowserSystem.newContext]', 'browser not loaded');
      throw new Error('[BrowserSystem.newContext] ERROR - browser not loaded');
    }
    return await this.browser.createBrowserContext(options);
  }
}
