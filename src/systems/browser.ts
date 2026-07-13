import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext, BrowserContextOptions } from 'playwright';

import { System } from '../types.js';

export default class BrowserSystem extends System {
  private browser: Browser | undefined;

  public async init(): Promise<void> {
    console.log('[marvin]', 'BrowserSystem.init');
    
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
  }

  public async drop(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        console.log('[marvin]', 'BrowserSystem.drop', 'closed');
      } catch (err) {
        console.error('[marvin]', 'BrowserSystem.drop', 'error:', err);
      }
      this.browser = undefined;
    } else {
      console.log('[marvin]', 'BrowserSystem.drop', 'already closed');
    }
  }

  public async newContext(options?: BrowserContextOptions) : Promise<BrowserContext> {
    if (!this.browser) {
      console.error('[marvin]', 'BrowserSystem.newContext', 'browser not initialized');
      throw new Error('BrowserSystem.newContext: browser not initialized');
    }
    return await this.browser.newContext(options);
  }
}
