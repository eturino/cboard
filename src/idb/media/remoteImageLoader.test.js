import { getCachedImage, putCachedImage } from './imageCache';
import { resolveRemoteImage } from './remoteImageLoader';

jest.mock('./imageCache', () => ({
  getCachedImage: jest.fn(),
  putCachedImage: jest.fn()
}));

const image = (url = 'https://example.com/symbol.png') => ({
  url,
  type: 'image/png',
  data: new ArrayBuffer(4)
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: true
  });
});

it('returns a durable cache hit without fetching', async () => {
  const cached = image();
  getCachedImage.mockResolvedValue(cached);

  await expect(resolveRemoteImage(cached.url, true)).resolves.toEqual(cached);

  expect(global.fetch).not.toHaveBeenCalled();
  expect(putCachedImage).not.toHaveBeenCalled();
});

it('fetches, returns, and stores an uncached image when caching is enabled', async () => {
  const fetched = image();
  getCachedImage.mockResolvedValue(undefined);
  global.fetch.mockResolvedValue({
    ok: true,
    headers: { get: () => fetched.type },
    arrayBuffer: async () => fetched.data
  });

  await expect(resolveRemoteImage(fetched.url, true)).resolves.toEqual({
    url: fetched.url,
    type: fetched.type,
    data: fetched.data
  });

  expect(putCachedImage).toHaveBeenCalledWith({
    url: fetched.url,
    type: fetched.type,
    data: fetched.data
  });
});

it('returns no bytes for an unreadable response and retries on a later call', async () => {
  const url = 'https://example.com/retry.png';
  getCachedImage.mockResolvedValue(undefined);
  global.fetch
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new ArrayBuffer(4)
    });

  await expect(resolveRemoteImage(url, true)).resolves.toBeUndefined();
  await expect(resolveRemoteImage(url, true)).resolves.toMatchObject({
    type: 'image/png'
  });

  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it('does not fetch when durable caching is disabled or offline', async () => {
  const url = 'https://example.com/no-fetch.png';
  getCachedImage.mockResolvedValue(undefined);

  await expect(resolveRemoteImage(url, false)).resolves.toBeUndefined();
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: false
  });
  await expect(resolveRemoteImage(url, true)).resolves.toBeUndefined();

  expect(global.fetch).not.toHaveBeenCalled();
});

it('shares one fetch and one cache write for concurrent cache misses', async () => {
  const url = 'https://example.com/shared.png';
  const data = new ArrayBuffer(4);
  getCachedImage.mockResolvedValue(undefined);
  let resolveFetch;
  global.fetch.mockReturnValue(
    new Promise((resolve) => {
      resolveFetch = resolve;
    })
  );

  const first = resolveRemoteImage(url, true);
  const second = resolveRemoteImage(url, true);
  resolveFetch({
    ok: true,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => data
  });

  await expect(Promise.all([first, second])).resolves.toEqual([
    { url, type: 'image/png', data },
    { url, type: 'image/png', data }
  ]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(putCachedImage).toHaveBeenCalledTimes(1);
});
