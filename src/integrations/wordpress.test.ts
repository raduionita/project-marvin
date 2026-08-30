import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import WordpressIntegration from './wordpress.js';

function buildEngine(): Engine {
  const engine = new Engine();
  engine.state = 'exec';
  return engine;
}

function mockFetch(data: { [key: string]: any }, status = 200): { calls: [string, any][] } {
  const calls: [string, any][] = [];
  globalThis.fetch = ((url: any, init?: any) => {
    calls.push([String(url), init]);
    return Promise.resolve({
      ok: status < 400,
      status,
      text: () => Promise.resolve(JSON.stringify(data)),
      json: () => Promise.resolve(data),
    } as Response);
  }) as typeof fetch;
  return { calls };
}

// --- call dispatch ---

test('create_post sends a POST to wp/v2/posts with draft status', async () => {
  const fetchMock = mockFetch({ id: 12, title: 'Hello' });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'create_post', title: 'Hello', content: 'World' });

  expect(result.status).toBe(200);
  expect(result.data.id).toBe(12);
  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ title: 'Hello', content: 'World', status: 'draft' });
});

test('create_post returns an error when title is missing', async () => {
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'create_post' });

  expect(result.error).toContain('title');
});

test('publish_post sends a request that sets status publish', async () => {
  const fetchMock = mockFetch({ id: 12, status: 'publish' });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'publish_post', id: 12 });

  expect(result.status).toBe(200);
  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts/12');
  expect(JSON.parse(init.body)).toEqual({ status: 'publish' });
});

test('list_posts GETs wp/v2/posts with per_page', async () => {
  const fetchMock = mockFetch([{ id: 1 }, { id: 2 }]);
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'list_posts', per_page: 5 });

  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts?per_page=5');
  expect(result.data.length).toBe(2);
});

test('list_posts supports standard REST global params', async () => {
  const fetchMock = mockFetch([]);
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  await integration.call({ tool: 'list_posts', per_page: 3, page: 2, search: 'hello world', status: 'publish', _fields: 'id,title' });

  const [url] = fetchMock.calls[0]!;
  expect(url).toContain('per_page=3');
  expect(url).toContain('page=2');
  expect(url).toContain('search=hello%20world');
  expect(url).toContain('status=publish');
  expect(url).toContain('_fields=id%2Ctitle');
});

test('list_posts builds a query only from provided params', async () => {
  const fetchMock = mockFetch([]);
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  await integration.call({ tool: 'list_posts' });

  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
  expect(init.method).toBe('GET');
});

test('builds the REST base from a site root endpoint', async () => {
  const fetchMock = mockFetch({ id: 1 });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'create_post', title: 'Hi' });

  expect(result.status).toBe(200);
  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
});

test('accepts an endpoint ending in /wp-json', async () => {
  const fetchMock = mockFetch({ id: 1 });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com/wp-json' });

  await integration.call({ tool: 'create_post', title: 'Hi' });

  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
});

test('accepts a full wp-json/wp/v2 endpoint unchanged', async () => {
  const fetchMock = mockFetch({ id: 1 });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com/wp-json/wp/v2/' });

  await integration.call({ tool: 'get_post', id: 3 });

  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts/3');
});

test('discover fetches the REST discovery index', async () => {
  const fetchMock = mockFetch({ namespaces: ['wp/v2'], routes: {} });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'discover' });

  expect(result.ok).toBe(true);
  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json');
  expect(result.data.namespaces).toContain('wp/v2');
});

test('create_post supports standard REST post fields when configured', async () => {
  const fetchMock = mockFetch({ id: 12 });
  const integration = new WordpressIntegration(buildEngine(), {
    type: 'wordpress', endpoint: 'https://example.com',
    tools: { create_post: { enabled: true, fields: { title: { type: 'string' }, content: { type: 'string' }, status: { type: 'string' }, slug: { type: 'string' }, featured_media: { type: 'integer' }, categories: { type: 'array' } } } },
  });

  await integration.call({ tool: 'create_post', title: 'Hello', slug: 'hello', status: 'publish', featured_media: 5, categories: [1, 2] });

  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
  expect(JSON.parse(init.body)).toEqual({ title: 'Hello', status: 'publish', slug: 'hello', featured_media: 5, categories: [1, 2] });
});

test('request tool allows a generic path/method/body', async () => {
  const fetchMock = mockFetch({ success: true });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com/' });

  const result = await integration.call({ tool: 'request', method: 'delete', path: '/pages/5', body: {} });

  expect(result.status).toBe(200);
  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/pages/5');
  expect(init.method).toBe('DELETE');
  expect(result.data.success).toBe(true);
});

test('request returns a normalized error on non-ok response', async () => {
  mockFetch({ message: 'forbidden' }, 401);
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'get_post', id: 5 });

  expect(result.status).toBe(401);
  expect(result.error).toContain('forbidden');
});

test('unknown tool returns an error', async () => {
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'explode' });

  expect(result.error).toContain('Unknown Wordpress tool');
});

test('sends Basic auth when user and appPassword are configured', async () => {
  const fetchMock = mockFetch({ id: 1 });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com', user: 'admin', appPassword: 'abcd efgh' });

  await integration.call({ tool: 'create_post', title: 'Hi' });

  const [, init] = fetchMock.calls[0]!;
  const expected = 'Basic ' + Buffer.from('admin:abcd efgh').toString('base64');
  expect(init.headers.Authorization).toBe(expected);
});

test('create_post with publish: true posts with status publish', async () => {
  const fetchMock = mockFetch({ id: 12 });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  await integration.call({ tool: 'create_post', title: 'Hello', content: 'World', publish: true });

  const [, init] = fetchMock.calls[0]!;
  expect(JSON.parse(init.body)).toEqual({ title: 'Hello', content: 'World', status: 'publish' });
});

test('request includes the raw body in the error on non-JSON 4xx responses', async () => {
  globalThis.fetch = (() => Promise.resolve({
    ok: false, status: 401,
    text: () => Promise.resolve('<html>forbidden</html>'),
    json: () => Promise.resolve({}),
  } as Response)) as typeof fetch;
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'get_post', id: 5 });

  expect(result.status).toBe(401);
  expect(result.error).toContain('<html>forbidden</html>');
});

test('request retries transient 5xx failures then reports the failure', async () => {
  let attempts = 0;
  globalThis.fetch = (() => {
    attempts++;
    return Promise.resolve({
      ok: false, status: 503,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    } as Response);
  }) as typeof fetch;
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'get_post', id: 5 });

  expect(attempts).toBe(3); // initial + 2 retries
  expect(result.status).toBe(503);
  expect(result.error).toContain('failed after retries');
});

test('request does not retry permanent 4xx errors', async () => {
  let attempts = 0;
  globalThis.fetch = (() => {
    attempts++;
    return Promise.resolve({
      ok: false, status: 404,
      text: () => Promise.resolve('{"code":"rest_post_invalid_id","message":"Invalid post ID"}'),
      json: () => Promise.resolve({}),
    } as Response);
  }) as typeof fetch;
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ tool: 'get_post', id: 5 });

  expect(attempts).toBe(1);
  expect(result.error).toContain('Invalid post ID');
});

// --- meta ---

test('meta lists the wordpress tools', async () => {
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const info = integration.meta;

  expect(info.type).toBe('wordpress');
  expect(Object.keys(info.tools)).toContain('create_post');
  expect(Object.keys(info.tools)).toContain('list_posts');
});

// --- discover (OPTIONS) ---

const OPTIONS_PAYLOAD = {
  endpoints: [
    { methods: ['GET'], args: { context: { type: 'string' } } },
    {
      methods: ['POST'],
      args: {
        title: { type: 'string', required: true, description: 'The title for the post.' },
        content: { type: 'string', description: 'The content for the post.' },
        status: { type: 'string', enum: ['publish', 'draft', 'pending'], description: 'A named status for the post.' },
      },
    },
  ],
};

test('discover parses the OPTIONS endpoint args into FieldDefs', async () => {
  const fetchMock = mockFetch(OPTIONS_PAYLOAD);
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const fields = await integration.discover('create_post');

  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
  expect(init.method).toBe('OPTIONS');

  expect(fields.find(f => f.name === 'title')?.required).toBe(true);
  expect(fields.find(f => f.name === 'content')?.required).toBe(false);
  expect(fields.find(f => f.name === 'status')?.enum).toEqual(['publish', 'draft', 'pending']);
  expect(fields.find(f => f.name === 'content')?.type).toBe('string');
});

test('discover keeps array and object types with their sub-properties', async () => {
  mockFetch({
    endpoints: [
      { methods: ['GET'], args: {} },
      {
        methods: ['POST'],
        args: {
          tags: { type: 'array', items: { type: 'integer' } },
          meta: {
            type: 'object',
            properties: {
              keywords: { type: 'array', items: { type: 'string' } },
              description: { type: 'string' },
            },
          },
        },
      },
    ],
  });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const fields = await integration.discover('create_post');

  const tags = fields.find(f => f.name === 'tags')!;
  expect(tags.type).toBe('array');

  const meta = fields.find(f => f.name === 'meta')!;
  expect(meta.type).toBe('object');
  expect(meta.properties?.keywords?.type).toBe('array');
  expect(meta.properties?.description?.type).toBe('string');
});

test('discover throws when the OPTIONS payload has no POST endpoint', async () => {
  mockFetch({ endpoints: [{ methods: ['GET'], args: {} }] });
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  await expect(integration.discover('create_post')).rejects.toThrow('no POST schema');
});

test('discover throws when the fetch fails', async () => {
  globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  await expect(integration.discover('create_post')).rejects.toThrow('network down');
});

test('discover throws for tools without a resource', async () => {
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  await expect(integration.discover('explode')).rejects.toThrow('no REST resource');
});

test('discover injects a required id for single-resource tools', async () => {
  mockFetch(OPTIONS_PAYLOAD);
  const integration = new WordpressIntegration(buildEngine(), { type: 'wordpress', endpoint: 'https://example.com' });

  const fields = await integration.discover('publish_post');

  const id = fields.find(f => f.name === 'id')!;
  expect(id).toBeDefined();
  expect(id.type).toBe('integer');
  expect(id.required).toBe(true);
  expect(fields.find(f => f.name === 'title')?.required).toBe(true);
});

test('update_post never sends the id in the request body', async () => {
  const fetchMock = mockFetch({ id: 7 });
  const integration = new WordpressIntegration(buildEngine(), {
    type: 'wordpress', endpoint: 'https://example.com',
    tools: { update_post: { enabled: true, fields: { id: { type: 'integer', required: true }, content: { type: 'string' } } } },
  });

  await integration.call({ tool: 'update_post', id: 7, content: 'New body' });

  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts/7');
  expect(JSON.parse(init.body)).toEqual({ content: 'New body' });
});

// --- config-driven field filtering + meta fields ---

test('create_post sends only the configured fields (drops invented params)', async () => {
  const fetchMock = mockFetch({ id: 12 });
  const integration = new WordpressIntegration(buildEngine(), {
    type: 'wordpress', endpoint: 'https://example.com',
    tools: { create_post: { enabled: true, fields: { title: { type: 'string', required: true }, content: { type: 'string' } } } },
  });

  await integration.call({ tool: 'create_post', title: 'Hi', content: 'World', invented: 'ignored' });

  const [, init] = fetchMock.calls[0]!;
  expect(JSON.parse(init.body)).toEqual({ title: 'Hi', content: 'World' });
});

test('create_post sends custom meta fields under the meta object', async () => {
  const fetchMock = mockFetch({ id: 12 });
  const integration = new WordpressIntegration(buildEngine(), {
    type: 'wordpress', endpoint: 'https://example.com',
    tools: { create_post: { enabled: true, fields: { title: { type: 'string', required: true } } } },
    meta: { target: 'meta', fields: { custom_author: { type: 'string', required: true }, featured: { type: 'boolean' } } },
  });

  await integration.call({ tool: 'create_post', title: 'Hi', custom_author: 'Ada', featured: true });

  const [, init] = fetchMock.calls[0]!;
  expect(JSON.parse(init.body)).toEqual({ title: 'Hi', meta: { custom_author: 'Ada', featured: true } });
});

test('create_post nests dotted configured fields under their parent object', async () => {
  const fetchMock = mockFetch({ id: 12 });
  const integration = new WordpressIntegration(buildEngine(), {
    type: 'wordpress', endpoint: 'https://example.com',
    tools: { create_post: { enabled: true, fields: { title: { type: 'string', required: true }, 'meta.keywords': { type: 'array' } } } },
  });

  await integration.call({ tool: 'create_post', title: 'Hi', 'meta.keywords': ['ai', 'ml'] });

  const [, init] = fetchMock.calls[0]!;
  expect(JSON.parse(init.body)).toEqual({ title: 'Hi', meta: { keywords: ['ai', 'ml'] } });
});

test('create_post sends custom fields under acf when target is acf', async () => {
  const fetchMock = mockFetch({ id: 12 });
  const integration = new WordpressIntegration(buildEngine(), {
    type: 'wordpress', endpoint: 'https://example.com',
    tools: { create_post: { enabled: true, fields: { title: { type: 'string', required: true } } } },
    meta: { target: 'acf', fields: { custom_author: { type: 'string' } } },
  });

  await integration.call({ tool: 'create_post', title: 'Hi', custom_author: 'Ada' });

  const [, init] = fetchMock.calls[0]!;
  expect(JSON.parse(init.body)).toEqual({ title: 'Hi', acf: { custom_author: 'Ada' } });
});
