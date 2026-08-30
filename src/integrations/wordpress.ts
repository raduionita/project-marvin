import { Integration, IntegrationMeta, Field } from '../types.js';
import { tryJsonParse, withRetry } from '../helpers/index.js';

export type WordpressConfig = { enabled?: boolean, endpoint?: string, user?: string, appPassword?: string };

// a raw WP REST arg definition (from the OPTIONS schema)
type RawArg = {
  type?: string;
  required?: boolean;
  description?: string;
  enum?: any[];
  items?: RawArg;
  properties?: { [key: string]: RawArg };
};

// Wordpress REST API integration (list/get/create/update/publish/delete).
export default class WordpressIntegration extends Integration {
  public meta = {
    type: 'wordpress',
    title: 'WordPress',
    description: 'Post articles to a Wordpress site via its REST API',
    arguments: {
      endpoint: 'https://example.com',
      user: 'admin',
      appPassword: 'xxxxXXXXxxxx',
    },
    tools: {
      list_posts: 'List posts on the site',
      get_post: 'Get a single post by id',
      create_post: 'Create a new post',
      update_post: 'Update an existing post',
      publish_post: 'Publish an existing draft post',
      delete_post: 'Delete a post',
    },
  } satisfies IntegrationMeta;

  // live field discovery via the Wordpress REST API OPTIONS route
  async discover(tool: string): Promise<Field[]> {
    const resource = this.toolToResource(tool);
    if (!resource) throw new Error(`no REST resource for tool "${tool}"`);

    // https://.../wp-json/wp/v2/posts
    const url = this.api(`/${resource}`);
    const res = await withRetry(() => fetch(url, { method: 'OPTIONS', headers: this.headers() }), {
      retries: 1, delayMs: 300, shouldRetry: (err) => (err as { transient?: boolean })?.transient === true,
    });
    const text = await res.text().catch(() => '');
    const json = tryJsonParse<{ endpoints?: { methods?: string[], args?: { [key: string]: any } }[] }>(text) || {};
    const endpoint = (json.endpoints || []).find(e => (e.methods || []).includes('POST'));
    if (!endpoint) throw new Error(`no POST schema found at ${url} for tool "${tool}"`);
    const fields = Object.entries(endpoint.args || {}).map(([name, def]) => this.normalizeArg(name, def));

    // single-resource tools need the resource id, which the collection
    // OPTIONS schema does not list: inject it as a required field
    const isSingle = ['get_post', 'update_post', 'publish_post', 'delete_post'].includes(tool);
    if (isSingle) {
      const idField: Field = { name: 'id', type: 'integer', required: true, description: 'Post id' };
      return [idField, ...fields.filter(f => f.name !== 'id')];
    }
    return fields;
  }

  async load(): Promise<void> {
    this.logger.debug('[WordpressIntegration.load]');

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

  async call(args: { [key: string]: any }): Promise<{ [key: string]: any }> {
    this.logger.debug('[WordpressIntegration.call]', JSON.stringify(args));

    const tool = args.tool || 'request';
    switch (tool) {
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
        return { error: `Unknown Wordpress tool: ${tool}` };
    }
  }

  // map an tool to its REST resource (posts/media/pages)
  private toolToResource(tool: string): string {
    const map: Record<string, string> = {
      list_posts: 'posts', get_post: 'posts', create_post: 'posts',
      update_post: 'posts', publish_post: 'posts', delete_post: 'posts',
    };
    return map[tool] || '';
  }

  // normalize a raw WP REST arg definition into our Field shape, recursing into
  // object `properties` and array `items` so sub-fields keep their own schema
  private normalizeArg(name: string, def: RawArg): Field {
    const type = def.type || 'string';
    const field: Field = {
      name,
      type,
      required: def.required === true,
      description: typeof def.description === 'string' ? def.description : '',
      ...(Array.isArray(def.enum) ? { enum: def.enum.map(String) } : {}),
    };

    // object types carry their sub-fields under `properties` (e.g. meta.description)
    const props = type === 'object' ? def.properties : (type === 'array' ? def.items?.properties : undefined);
    if (props && typeof props === 'object') {
      field.properties = Object.fromEntries(
        Object.entries(props).map(([n, p]) => [n, this.normalizeArg(n, p)]),
      );
    }
    return field;
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
  private async request(method: string, path: string, body?: { [key: string]: any }): Promise<{ [key: string]: any }> {
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

  // build the request body from the *configured* fields only (the per-tool
  // fields chosen during `marvin integrations add`, or the legacy flat
  // config.parameters), plus config.meta custom fields, so invented/unknown
  // LLM params never reach the API.
  private buildBody(tool: string, args: { [key: string]: any }): { [key: string]: any } {
    const body: { [key: string]: any } = {};

    // direct fields: configured per-tool fields > legacy flat parameters
    const toolCfg = this.config.tools?.[tool]?.fields as { [key: string]: any } | undefined;
    const flat = this.config.parameters;
    let allowed: Field[] = [];
    if (toolCfg && typeof toolCfg === 'object' && Object.keys(toolCfg).length) {
      allowed = Object.entries(toolCfg).map(([name, def]) => ({
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
      // id is a URL parameter for single-resource tools, never a body field
      if (tool === 'update_post' && f.name === 'id') continue;
      // dotted field names (e.g. meta.keywords) map to nested body objects;
      // the caller may pass them flat (meta.keywords) or nested (meta.keywords)
      const parts = f.name.split('.');
      let value = args[f.name];
      if (value === undefined) {
        value = args;
        for (const p of parts) {
          if (value === undefined || value === null) break;
          value = value[p];
        }
      }
      if (value === undefined) continue;
      let node = body;
      for (let i = 0; i < parts.length - 1; i++) {
        node[parts[i]!] = node[parts[i]!] ?? {};
        node = node[parts[i]!];
      }
      node[parts[parts.length - 1]!] = value;
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

  private hasConfiguredFields(tool: string): boolean {
    const toolCfg = this.config.tools?.[tool]?.fields;
    if (toolCfg && typeof toolCfg === 'object' && Object.keys(toolCfg).length) return true;
    const flat = this.config.parameters;
    return !!(flat && typeof flat === 'object' && Object.keys(flat).length);
  }
}
