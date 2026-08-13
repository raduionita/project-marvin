import { Integration } from '../types.js';

export type WordpressConfig = { enabled?: boolean, endpoint?: string, user?: string, appPassword?: string };

// Wordpress REST API integration (list/get/create/update/publish/delete).
export default class WordpressIntegration extends Integration {
  public args = {
    endpoint: 'https://example.com',
    user: 'admin',
    appPassword: 'xxxx xxxx xxxx xxxx xxxx xxxx',
  }

  async load(): Promise<void> {
    this.logger.debug('[WordpressIntegration.load]');
    if (this.engine.isDry) {
      this.logger.debug('[WordpressIntegration.load]', '[dry] integration wordpress attached');
      return;
    }

    if (!this.config.endpoint) {
      this.logger.error('[WordpressIntegration.load]', 'no endpoint found, skipping');
    }
  }

  async drop(): Promise<void> {
    this.logger.debug('[WordpressIntegration.drop]');
  }

  // build the full REST (…/wp-json) or (…/wp-json/wp/v2);
  private api(path: string) {
    const endpoint = (this.config.endpoint || '').replace(/\/+$/, '');
    let base = endpoint;
    if (!/\/wp-json\/wp\/v2$/.test(base)) {
      if (!/\/wp-json$/.test(base)) {
        base = `${base}/wp-json`;
      }
      base = `${base}/wp/v2`;
    }
    return `${base}${path}`;
  }

  // headers with Basic auth (Wordpress application passwords)
  private headers(): { [key: string]: string } {
    const headers: { [key: string]: string } = { 'Content-Type': 'application/json' };
    const user = this.config.user || '';
    const appPassword = this.config.appPassword || '';
    if (user && appPassword) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${appPassword}`).toString('base64');
    }
    return headers;
  }

  // low-level generic request to the Wordpress REST API
  async request(method: string, path: string, body?: { [key: string]: any }): Promise<{ [key: string]: any }> {
    this.logger.debug('[WordpressIntegration.request]', method, path);

    const url = this.api(path);
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: `Wordpress API ${res.status}: ${JSON.stringify(data)}`, status: res.status };
    }
    return { data, status: res.status };
  }

  async call(args: { [key: string]: any }): Promise<{ [key: string]: any }> {
    this.logger.debug('[WordpressIntegration.call]', JSON.stringify(args));

    const action = args.action || 'request';
    switch (action) {
      case 'list_posts': {
        // standard global query params (see developer.wordpress.org/rest-api)
        const query = [
          ['page', args.page],
          ['per_page', args.per_page],
          ['search', args.search],
          ['status', args.status],
          ['author', args.author],
          ['categories', args.categories],
          ['_fields', args._fields],
        ].filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&');
        return this.request('GET', `/posts${query ? `?${query}` : ''}`);
      }
      case 'get_post': {
        if (!args.id) return { error: 'Wordpress get_post: missing id' };
        const query = args._fields ? `?_fields=${encodeURIComponent(String(args._fields))}` : '';
        return this.request('GET', `/posts/${args.id}${query}`);
      }
      case 'create_post': {
        if (!args.title) return { error: 'Wordpress create_post: missing title' };
        return this.request('POST', '/posts', {
          title: args.title,
          content: args.content || '',
          status: args.status || 'draft',
          ...(args.slug ? { slug: args.slug } : {}),
          ...(args.excerpt ? { excerpt: args.excerpt } : {}),
          ...(args.featured_media ? { featured_media: args.featured_media } : {}),
          ...(args.categories ? { categories: args.categories } : {}),
          ...(args.tags ? { tags: args.tags } : {}),
        });
      }
      case 'update_post': {
        if (!args.id) return { error: 'Wordpress update_post: missing id' };
        const body: { [key: string]: any } = {};
        if (args.title !== undefined) body.title = args.title;
        if (args.content !== undefined) body.content = args.content;
        if (args.status !== undefined) body.status = args.status;
        if (args.slug !== undefined) body.slug = args.slug;
        if (args.excerpt !== undefined) body.excerpt = args.excerpt;
        if (args.featured_media !== undefined) body.featured_media = args.featured_media;
        if (args.categories !== undefined) body.categories = args.categories;
        if (args.tags !== undefined) body.tags = args.tags;
        return this.request('POST', `/posts/${args.id}`, body);
      }
      case 'publish_post': {
        if (!args.id) return { error: 'Wordpress publish_post: missing id' };
        return this.request('POST', `/posts/${args.id}`, { status: 'publish' });
      }
      case 'delete_post': {
        if (!args.id) return { error: 'Wordpress delete_post: missing id' };
        return this.request('DELETE', `/posts/${args.id}?force=true`);
      }
      case 'request': {
        const method = (args.method || 'GET').toUpperCase();
        const path = args.path || '';
        if (!path) return { error: 'Wordpress request: missing path' };
        return this.request(method, path, args.body);
      }
      case 'discover': {
        // GET the REST index (route discovery) - see developer.wordpress.org/rest-api/using-the-rest-api/discovery/
        const base = this.api('/');
        const res = await fetch(base.replace(/\/wp\/v2\/?$/, '') || `${this.config.endpoint}/wp-json`, { headers: this.headers() });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
      }
      default:
        return { error: `Unknown Wordpress action: ${action}` };
    }
  }
}
