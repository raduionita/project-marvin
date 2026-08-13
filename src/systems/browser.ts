import puppeteer from 'puppeteer-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Browser, HTTPRequest, Page } from 'puppeteer';

import { System } from '../types.js';

export default class BrowserSystem extends System {
  private browser: Browser | undefined;

  public async load(): Promise<void> {
    this.logger.debug('[BrowserSystem.load]');

    if (this.engine.isDry) {
      this.logger.info('[BrowserSystem.load]', '[dry] loading chromium');
      return;
    }
    
    puppeteer.use(stealth());

    this.browser = await puppeteer.launch({
      // TODO: adapt to different OSs
      executablePath: '/usr/bin/chromium-browser',
      headless: true,
      args: [
        // for ducker/ci/root env, chrome won't start sandbox w/o these
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // /dev/shm (tiny 64MB in containers), chrome uses it for cache, can cause crashes
        '--disable-dev-shm-usage',
        // no rendering
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        // disable chrome features/subsystems
        '--disable-extensions',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--disable-background-networking',
        '--disable-breakpad',
        '--no-first-run',
        // disable process forking
        '--no-zygote',
        // os-level window size
        '--window-size=800,600',
        // mute audio
        '--mute-audio',

        // '--disable-background-timer-throttling',
        // '--disable-renderer-backgrounding'
      ],
      defaultViewport: { width: 800, height: 600 },
      // todo: proxies
    });

    this.logger.debug('[BrowserSystem.load]', 'browser:', await puppeteer.executablePath());
  }

  public async drop(): Promise<void> {
    this.logger.debug('[BrowserSystem.drop]');
    if (this.browser) {
      try {
        await this.browser.close();
        this.logger.debug('[BrowserSystem.drop]', 'closed');
      } catch (err) {
        this.logger.error('[BrowserSystem.drop]', 'error:', err);
      }
      this.browser = undefined;
    } else {
      this.logger.debug('[BrowserSystem.drop]', 'already closed');
    }
  }

  public async newPage(onRequest?: (request: HTTPRequest) => void) : Promise<Page> {
    this.logger.debug('[BrowserSystem.newPage]');

    if (!this.browser) {
      this.logger.error('[BrowserSystem.newPage]', 'browser not loaded');
      throw new Error('[BrowserSystem.newPage] ERROR - browser not loaded');
    }

    const page = await this.browser.newPage();

    page.setViewport({ width: 800, height: 600 });
    page.setJavaScriptEnabled(true);
    page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.56 Safari/537.36');
    page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    page.setBypassCSP(true);

    if (!onRequest) {
      onRequest = (request: HTTPRequest) => {
        if (['image', 'stylesheet', 'script', 'font', 'media', 'xhr', 'other'].includes(request.resourceType())) {
          // this.logger.debug('[BrowserSystem.newPage]', 'blocking', request.resourceType(), request.url());
          return request.abort();
        } else {
          this.logger.debug('[BrowserSystem.newPage]', 'allowing', request.resourceType(), request.url());
          return request.continue();
        }
      };
    }

    await page.setRequestInterception(true);
    page.on('request', onRequest);

    return page;
  }
}
