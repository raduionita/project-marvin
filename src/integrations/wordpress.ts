import { Integration, IntegrationMeta, Field } from '../types.js';
import { tryJsonParse, withRetry } from '../helpers.js';

export type WordpressConfig = { enabled?: boolean, endpoint?: string, user?: string, appPassword?: string };

// Wordpress REST API integration (list/get/create/update/publish/delete).
export default class WordpressIntegration extends Integration {
  public args = {
    endpoint: 'https://example.com',
    user: 'admin',
    appPassword: 'xxxxXXXXxxxx',
  }

  public meta = {
    type: 'wordpress',
    title: 'WordPress',
    description: 'Post articles to a Wordpress site via its REST API',
    actions: [
      { name: 'list_posts', description: 'List posts on the site' },
      { name: 'get_post', description: 'Get a single post by id' },
      { name: 'create_post', description: 'Create a new post' },
      { name: 'update_post', description: 'Update an existing post' },
      { name: 'publish_post', description: 'Publish an existing draft post' },
      { name: 'delete_post', description: 'Delete a post' },
    ],
  } satisfies IntegrationMeta;

  // map an action to its REST resource (posts/media/pages)
  private actionToResource(action: string): string {
    const map: Record<string, string> = {
      list_posts: 'posts', get_post: 'posts', create_post: 'posts',
      update_post: 'posts', publish_post: 'posts', delete_post: 'posts',
    };
    return map[action] || '';
  }

  // normalize a raw WP REST arg definition into our FieldDef shape
  private normalizeArg(name: string, def: { type?: string, required?: boolean, description?: string, enum?: any[], items?: { type?: string } }): Field {
    let type = def.type || 'string';
    if (type === 'object' && def.items) type = def.items.type || 'object';
    return {
      name,
      type: type === 'integer' ? 'integer' : type,
      required: def.required === true,
      description: typeof def.description === 'string' ? def.description : '',
      ...(Array.isArray(def.enum) ? { enum: def.enum.map(String) } : {}),
    };
  }

  // live field discovery via the Wordpress REST API OPTIONS route. throws when
  // the resource is unknown or the site exposes no POST schema for it.
  async discover(action: string): Promise<Field[]> {
    const resource = this.actionToResource(action);
    if (!resource) throw new Error(`no REST resource for action "${action}"`);

    const url = this.api(`/${resource}`);
    const res = await withRetry(() => fetch(url, { method: 'OPTIONS', headers: this.headers() }), {
      retries: 1, delayMs: 300, shouldRetry: (err) => (err as { transient?: boolean })?.transient === true,
    });
    const raw = await res.text().catch(() => '');
    const data = tryJsonParse<{ endpoints?: { methods?: string[], args?: { [key: string]: any } }[] }>(raw) || {};
    const endpoint = (data.endpoints || []).find(e => (e.methods || []).includes('POST'));
    if (!endpoint) throw new Error(`no POST schema found at ${url} for action "${action}"`);
    return Object.entries(endpoint.args || {}).map(([name, def]) => this.normalizeArg(name, def));
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
    if (!this.config.user || !this.config.appPassword) {
      this.logger.warn('[WordpressIntegration.load]', 'no user/appPassword found, authenticated calls will fail with 401');
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

    // retry transient failures (network errors, 5xx, 429); 4xx are permanent
    let res: Response;
    try {
      res = await withRetry(async () => {
        const r = await fetch(url, {
          method,
          headers: this.headers(),
          body: body ? JSON.stringify(body) : undefined,
        });
        if (r.status >= 500 || r.status === 429) {
          await r.text().catch(() => '');
          throw Object.assign(new Error(`HTTP ${r.status}`), { transient: true, status: r.status });
        }
        return r;
      }, { retries: 2, delayMs: 400, shouldRetry: (err) => (err as { transient?: boolean })?.transient === true });
    } catch (err) {
      const status = (err as { status?: number })?.status || 0;
      return { error: `Wordpress API request failed after retries (${(err as Error).message})`, status };
    }

    // capture the raw body for diagnostics (WP error pages are often HTML)
    const raw = await res.text().catch(() => '');
    const data = tryJsonParse<{ [key: string]: any }>(raw) || {};
    if (!res.ok) {
      const detail = data?.message ? ` ${data.message}` : (raw ? ` ${raw.slice(0, 300)}` : '');
      return { error: `Wordpress API ${res.status}:${detail}`, status: res.status, data };
    }
    return { data, status: res.status };
  }

  // build the request body from the *configured* fields only (the per-action
  // fields chosen during `marvin integrations add`, or the legacy flat
  // config.parameters), plus config.meta custom fields, so invented/unknown
  // LLM params never reach the API.
  private buildBody(action: string, args: { [key: string]: any }): { [key: string]: any } {
    const body: { [key: string]: any } = {};

    // direct fields: configured per-action fields > legacy flat parameters
    const actionCfg = this.config.actions?.[action]?.fields as { [key: string]: any } | undefined;
    const flat = this.config.parameters;
    let allowed: Field[] = [];
    if (actionCfg && typeof actionCfg === 'object' && Object.keys(actionCfg).length) {
      allowed = Object.entries(actionCfg).map(([name, def]) => ({
        name,
        type: (def as any)?.type || 'string',
        required: (def as any)?.required === true,
        description: (def as any)?.description || '',
        ...((def as any)?.enum ? { enum: (def as any).enum } : {}),
      }));
    } else if (flat && typeof flat === 'object' && Object.keys(flat).length) {
      allowed = Object.entries(flat).map(([name, def]) => ({
        name,
        type: (def as any)?.type || 'string',
        required: (def as any)?.required === true,
        description: (def as any)?.description || '',
        ...((def as any)?.enum ? { enum: (def as any).enum } : {}),
      }));
    }
    for (const f of allowed) {
      if (args[f.name] !== undefined) body[f.name] = args[f.name];
    }

    // meta/acf custom fields live under their own object
    const meta = this.config.meta;
    const metaFields = (meta && typeof meta === 'object' && meta.fields && typeof meta.fields === 'object')
      ? meta.fields as { [key: string]: any }
      : {};
    const metaTarget = (meta?.target === 'acf') ? 'acf' : 'meta';
    const metaObj: { [key: string]: any } = {};
    for (const [name, def] of Object.entries(metaFields)) {
      if (args[name] !== undefined) metaObj[name] = args[name];
    }
    if (Object.keys(metaObj).length) body[metaTarget] = metaObj;

    return body;
  }

  private hasConfiguredFields(action: string): boolean {
    const actionCfg = this.config.actions?.[action]?.fields;
    if (actionCfg && typeof actionCfg === 'object' && Object.keys(actionCfg).length) return true;
    const flat = this.config.parameters;
    return !!(flat && typeof flat === 'object' && Object.keys(flat).length);
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
        const body = this.buildBody('create_post', args);
        if (this.hasConfiguredFields('create_post')) {
          // config-driven: only send configured fields + the status the caller asked for
          if (body.status === undefined && (args.status || args.publish)) body.status = args.status || 'publish';
        } else {
          // no configured fields: send the core create_post fields
          body.title = args.title;
          body.content = args.content || '';
          if (body.status === undefined) body.status = args.publish ? 'publish' : 'draft';
        }
        return this.request('POST', '/posts', body);
      }
      case 'update_post': {
        if (!args.id) return { error: 'Wordpress update_post: missing id' };
        const body = this.buildBody('update_post', args);
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
