import TurndownService from 'turndown';

import { HTTPRequest } from 'puppeteer';

import { Tool } from '../types.js';
import type { ToolMeta } from '../types.js';
import { delay, rand, readError, tryJsonParse } from '../helpers/index.js';
import type BrowserSystem from '../systems/browser.js';
import Engine from '../engine.js';
import logger from '../logger.js';
import * as constants from '../constants.js';

const SEARCH_START_TAG = "DDG.pageLayout.load('d',";
const SEARCH_END_TAG = ");DDG.duckbar.loadModule";

export default class WebSearchTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'web',
    function: {
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          type: {
            type: 'string',
            enum: ['web', 'images', 'news'],
            description: 'Search type: web (default), images, news.',
          }
        },
        required: ['query'],
      }
    },
  }

  private turndown: TurndownService = new TurndownService({ headingStyle: 'atx', hr: '---', codeBlockStyle: 'fenced' });

  constructor(engine: Engine) {
    super(engine);
    this.turndown.remove([
      'script',
      'style',
      'aside',
      'nav',
      'footer',
      'iframe',
      'noscript',
      'meta',
      'link',
      'button',
      'canvas',
      'audio',
      'video',
      'source',
      'track',
      'embed',
      'object',
      'picture',
      'colgroup',
      'form', 'input', 'select', 'textarea', 'optgroup', 'option', 'label', 'fieldset',
      'head',
      'map', 'area',
      'template',
      'dialog',
    ]);
  }

  public async call(args: { query: string, type?: 'web' | 'images' | 'news' }) {
    logger.debug('[WebSearchTool.call]', args.query.slice(0, 64));

    switch (args.type) {
      case 'images':
        return await this.callImages(args);
      case 'news':
        return await this.callNews(args);
      case 'web':
      default:
        return await this.callWeb(args);
    }
  }

  private async callWeb(args: { query: string }) {
    logger.debug('[WebSearchTool.callWeb]', args.query.slice(0, 64));

    if (!this.engine.systems['browser']) {
      throw new Error('[WebSearchTool.call] ERROR - Browser is not loaded in the server engine');
    }

    const browser = this.engine.systems['browser'] as BrowserSystem;
    const query = args.query;
    const url = `https://duckduckgo.com?q=${query}&df=d&kp=-1&kc=-1&kz=-1&kl=wt-wt`;
    const src = 'links.duckduckgo.com/d.js';

    let page: Awaited<ReturnType<BrowserSystem['newPage']>> | undefined;
    let raw: string | undefined;
    try {
      page = await browser.newPage((request) => {
        const type = request.resourceType();
        const url = request.url();
        if (type === 'script' && !url.includes(src)) {
          // logger.debug('[WebSearchTool.newPage]', 'blocking', type, url);
          return request.abort();
        } else if (['image', 'stylesheet', 'font', 'media', 'other', 'manifest', 'xhr'].includes(type)) {
          // logger.debug('[WebSearchTool.newPage]', 'blocking', type, url);
          return request.abort();
        } else {
          logger.debug('[WebSearchTool.newPage]', 'allowing', type, url);
          return request.continue();
        }
      });
      page.setDefaultNavigationTimeout(10_000);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 });

      // after the html/doc is loaded, duck requests d.js that contains the search results
      const script = await page.waitForResponse((response) => response.url().includes(src), { timeout: 5_000 });
      const text = await script.text();

      // done with the page
      await page.close();

      // the results need to be extracted/parsed
      const start = text.indexOf(SEARCH_START_TAG);
      const end = text.indexOf(SEARCH_END_TAG, start);
            raw = text.substring(start + SEARCH_START_TAG.length, end);
      // in case result is actually empty
            raw = raw.replaceAll('window.execDeep = funct', ''); 
      const json: any[] = tryJsonParse(raw) || [];
            json.length = Math.min(json.length, 10);
      return { 
        description: json.length ? `${json.length} results` : 'no results',
        results: json.map((o: { [key: string]: any }) => ({
          title: this.turndown.turndown(o.t || ''),
          body: (this.turndown.turndown(o.a || '')).slice(0, constants.MAX_TOOL_RESULT_CHARS),
          link: o.c || '',
        })),
      };
    } catch (error) {
      if (page && !page.isClosed()) {
        logger.debug('[WebSearchTool.callWeb]', 'closing page');
        await page.close();
      }
      // distinguish "search failed" from "no results", so the LLM does not
      // conclude nothing exists when the scrape/parse simply failed
      logger.error('[WebSearchTool.callWeb]', 'error:', readError(error), 'url:', url, 'query:', query, 'raw:', raw?.substring(0,100));
      return { 
        results: [], 
        error: `web_search failed: ${(error as Error).message}` 
      };
    } finally {
      if (page && !page.isClosed()) {
        logger.debug('[WebSearchTool.callWeb]', 'closing page');
        await page.close();
      }
    }
  }

  private async callImages(args: { query: string }) {
    logger.debug('[WebSearchTool.callImages]', args.query.slice(0, 64));

    if (!this.engine.systems['browser']) {
      throw new Error('[WebSearchTool.callImages] ERROR - Browser is not loaded in the server engine');
    }

    const browser = this.engine.systems['browser'] as BrowserSystem;
    const query = args.query;
    const url = `https://duckduckgo.com?q=${query}&df=d&kp=-1&kc=-1&kz=-1&kl=wt-wt&ia=images&iax=images`;
    const src = 'duckduckgo.com/i.js';

    let page: Awaited<ReturnType<BrowserSystem['newPage']>> | undefined;
    let raw: string | undefined;
    try {
      page = await browser.newPage((request) => {
        const type = request.resourceType();
        const url = request.url();
        if (type === 'script' && !url.includes(src)) {
          // logger.debug('[WebSearchTool.newPage]', 'blocking', type, url);
          return request.abort();
        } else if (['image', 'stylesheet', 'font', 'media', 'other', 'manifest', 'xhr'].includes(type)) {
          // logger.debug('[WebSearchTool.newPage]', 'blocking', type, url);
          return request.abort();
        } else {
          logger.debug('[WebSearchTool.newPage]', 'allowing', type, url);
          return request.continue();
        }
      });
      page.setDefaultNavigationTimeout(10_000);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 });

      // after the html/doc is loaded, duck requests d.js that contains the search results
      const script = await page.waitForResponse((response) => response.url().includes(src), { timeout: 5_000 });
      const text = await script.text();

      // done with the page
      await page.close();

      // parse the results
      const json = tryJsonParse<{results:{image:string, title:string}[]}>(text) || {results:[]};
            json.results.length = Math.min(json.results.length, 20);

      return { 
        description: json.results.length ? `${json.results.length} results` : 'no results',
        results: json.results.map((i: { image: string, title: string }) => ({
          title: i.title,
          image: i.image,
        }))
      };
    } catch (error) {
      if (page && !page.isClosed()) {
        logger.debug('[WebSearchTool.callImages]', 'closing page');
        await page.close();
      }
      // distinguish "search failed" from "no results", so the LLM does not
      // conclude nothing exists when the scrape/parse simply failed
      logger.error('[WebSearchTool.callImages]', 'error:', readError(error), 'url:', url, 'query:', query, 'raw:', raw?.substring(0,100));
      return { 
        results: [], 
        error: `web_search failed: ${(error as Error).message}` 
      };
    } finally {
      if (page && !page.isClosed()) {
        logger.debug('[WebSearchTool.callImages]', 'closing page');
        await page.close();
      }
    }
  }

  private async callNews(args: { query: string }) {
    logger.debug('[WebSearchTool.callNews]', args.query.slice(0, 64));

    if (!this.engine.systems['browser']) {
      throw new Error('[WebSearchTool.call] ERROR - Browser is not loaded in the server engine');
    }

    const browser = this.engine.systems['browser'] as BrowserSystem;
    const query = args.query;
    const url = `https://duckduckgo.com?q=${query}&df=d&kp=-1&kc=-1&kz=-1&kl=wt-wt&ia=news&iar=news`;
    const src = 'duckduckgo.com/news.js';

    let page: Awaited<ReturnType<BrowserSystem['newPage']>> | undefined;
    let raw: string | undefined;
    try {
      page = await browser.newPage((request) => {
        const type = request.resourceType();
        const url = request.url();
        if (type === 'script' && !url.includes(src)) {
          // logger.debug('[WebSearchTool.newPage]', 'blocking', type, url);
          return request.abort();
        } else if (['image', 'stylesheet', 'font', 'media', 'other', 'manifest', 'xhr'].includes(type)) {
          // logger.debug('[WebSearchTool.newPage]', 'blocking', type, url);
          return request.abort();
        } else {
          logger.debug('[WebSearchTool.newPage]', 'allowing', type, url);
          return request.continue();
        }
      });
      page.setDefaultNavigationTimeout(10_000);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 });

      // after the html/doc is loaded, duck requests d.js that contains the search results
      const script = await page.waitForResponse((response) => response.url().includes(src), { timeout: 5_000 });
      const text = await script.text();

      // done with the page
      await page.close();

      // the results need to be extracted/parsed
      const json: {results:{title:string, url:string, excerpt:string, image:string}[]} = tryJsonParse(text) || {results:[]};
            json.results.length = Math.min(json.results.length, 10);

      return { 
        description: json.results.length ? `${json.results.length} results` : 'no results',
        results: json.results.map((n: {title:string, url:string, excerpt:string, image:string}) => ({
          title: this.turndown.turndown(n.title || ''),
          excerpt: (this.turndown.turndown(n.excerpt || '')).slice(0, constants.MAX_TOOL_RESULT_CHARS),
          url: n.url || '',
          image: n.image || '',
        })),
      };
    } catch (error) {
      if (page && !page.isClosed()) {
        logger.debug('[WebSearchTool.callWeb]', 'closing page');
        await page.close();
      }
      // distinguish "search failed" from "no results", so the LLM does not
      // conclude nothing exists when the scrape/parse simply failed
      logger.error('[WebSearchTool.callWeb]', 'error:', readError(error), 'url:', url, 'query:', query, 'raw:', raw?.substring(0,100));
      return { 
        results: [], 
        error: `web_search failed: ${(error as Error).message}` 
      };
    } finally {
      if (page && !page.isClosed()) {
        logger.debug('[WebSearchTool.callWeb]', 'closing page');
        await page.close();
      }
    }
  }
}
