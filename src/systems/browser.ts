import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';

import { System } from '../types.js';

export default class BrowserSystem extends System {
  private browser: Browser | undefined;
  private bctx: BrowserContext | undefined;

  public async init(): Promise<void> {
    console.log('[BrowserSystem.init]');
    
    chromium.use(stealth());

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding'
      ],
      // todo: proxies
    });

    this.bctx = await this.browser.newContext({
      viewport: { width: 1200, height: 800 },
      javaScriptEnabled: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.56 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      bypassCSP: true,
    });

    await this.bctx.route('**/*', (route) => {
      const request = route.request();
      // request.url().includes('links.duckduckgo.com/d.js') || 
      if (request.isNavigationRequest()) {
        return route.continue();
      } else {
        return route.abort();
      }
    });
  }

  public async drop(): Promise<void> {
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
      console.error('[BrowserSystem.newPage]', 'browser not initialized');
      throw new Error('[BrowserSystem.newPage] ERROR - browser not initialized');
    }
    if (!this.bctx) {
      console.error('[BrowserSystem.newPage]', 'browser context not initialized');
      throw new Error('[BrowserSystem.newPage] ERROR - browser context not initialized');
    }
    return await this.bctx.newPage();
  }

  public async newContext(options?: BrowserContextOptions) : Promise<BrowserContext> {
    if (!this.browser) {
      console.error('[BrowserSystem.newContext]', 'browser not initialized');
      throw new Error('[BrowserSystem.newContext] ERROR - browser not initialized');
    }
    return await this.browser.newContext(options);
  }
}
