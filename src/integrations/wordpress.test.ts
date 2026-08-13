import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import WordpressIntegration from './wordpress.js';

function buildEngine(): Engine {
  const engine = new Engine(new Logger());
  engine.state = 'exec';
  return engine;
}

function mockFetch(data: { [key: string]: any }, status = 200): { calls: [string, any][] } {
  const calls: [string, any][] = [];
  globalThis.fetch = ((url: any, init?: any) => {
    calls.push([String(url), init]);
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) } as Response);
  }) as typeof fetch;
  return { calls };
}

// --- call dispatch ---

test('create_post sends a POST to wp/v2/posts with draft status', async () => {
  const fetchMock = mockFetch({ id: 12, title: 'Hello' });
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ action: 'create_post', title: 'Hello', content: 'World' });

  expect(result.status).toBe(200);
  expect(result.data.id).toBe(12);
  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ title: 'Hello', content: 'World', status: 'draft' });
});

test('create_post returns an error when title is missing', async () => {
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ action: 'create_post' });

  expect(result.error).toContain('title');
});

test('publish_post sends a request that sets status publish', async () => {
  const fetchMock = mockFetch({ id: 12, status: 'publish' });
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ action: 'publish_post', id: 12 });

  expect(result.status).toBe(200);
  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts/12');
  expect(JSON.parse(init.body)).toEqual({ status: 'publish' });
});

test('list_posts GETs wp/v2/posts with per_page', async () => {
  const fetchMock = mockFetch([{ id: 1 }, { id: 2 }]);
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ action: 'list_posts', per_page: 5 });

  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts?per_page=5');
  expect(result.data.length).toBe(2);
});

test('list_posts supports standard REST global params', async () => {
  const fetchMock = mockFetch([]);
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  await integration.call({ action: 'list_posts', per_page: 3, page: 2, search: 'hello world', status: 'publish', _fields: 'id,title' });

  const [url] = fetchMock.calls[0]!;
  expect(url).toContain('per_page=3');
  expect(url).toContain('page=2');
  expect(url).toContain('search=hello%20world');
  expect(url).toContain('status=publish');
  expect(url).toContain('_fields=id%2Ctitle');
});

test('list_posts builds a query only from provided params', async () => {
  const fetchMock = mockFetch([]);
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  await integration.call({ action: 'list_posts' });

  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
  expect(init.method).toBe('GET');
});

test('builds the REST base from a site root endpoint', async () => {
  const fetchMock = mockFetch({ id: 1 });
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ action: 'create_post', title: 'Hi' });

  expect(result.status).toBe(200);
  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
});

test('accepts an endpoint ending in /wp-json', async () => {
  const fetchMock = mockFetch({ id: 1 });
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com/wp-json' });

  await integration.call({ action: 'create_post', title: 'Hi' });

  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
});

test('accepts a full wp-json/wp/v2 endpoint unchanged', async () => {
  const fetchMock = mockFetch({ id: 1 });
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com/wp-json/wp/v2/' });

  await integration.call({ action: 'get_post', id: 3 });

  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts/3');
});

test('discover fetches the REST discovery index', async () => {
  const fetchMock = mockFetch({ namespaces: ['wp/v2'], routes: {} });
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ action: 'discover' });

  expect(result.ok).toBe(true);
  const [url] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json');
  expect(result.data.namespaces).toContain('wp/v2');
});

test('create_post supports standard REST post fields', async () => {
  const fetchMock = mockFetch({ id: 12 });
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  await integration.call({ action: 'create_post', title: 'Hello', slug: 'hello', status: 'publish', featured_media: 5, categories: [1, 2] });

  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
  expect(JSON.parse(init.body)).toEqual({ title: 'Hello', content: '', status: 'publish', slug: 'hello', featured_media: 5, categories: [1, 2] });
});

test('request action allows a generic path/method/body', async () => {
  const fetchMock = mockFetch({ success: true });
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com/' });

  const result = await integration.call({ action: 'request', method: 'delete', path: '/pages/5', body: {} });

  expect(result.status).toBe(200);
  const [url, init] = fetchMock.calls[0]!;
  expect(url).toBe('https://example.com/wp-json/wp/v2/pages/5');
  expect(init.method).toBe('DELETE');
  expect(result.data.success).toBe(true);
});

test('request returns a normalized error on non-ok response', async () => {
  mockFetch({ message: 'forbidden' }, 401);
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ action: 'get_post', id: 5 });

  expect(result.status).toBe(401);
  expect(result.error).toContain('forbidden');
});

test('unknown action returns an error', async () => {
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com' });

  const result = await integration.call({ action: 'explode' });

  expect(result.error).toContain('Unknown Wordpress action');
});

test('sends Basic auth when user and appPassword are configured', async () => {
  const fetchMock = mockFetch({ id: 1 });
  const integration = new WordpressIntegration(buildEngine(), new Logger(), { type: 'wordpress', endpoint: 'https://example.com', user: 'admin', appPassword: 'abcd efgh' });

  await integration.call({ action: 'create_post', title: 'Hi' });

  const [, init] = fetchMock.calls[0]!;
  const expected = 'Basic ' + Buffer.from('admin:abcd efgh').toString('base64');
  expect(init.headers.Authorization).toBe(expected);
});
