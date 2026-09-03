import { getCachedImage, putCachedImage } from './imageCache';
import type { CachedMedia } from './db';

export type ResolvedRemoteImage = Pick<CachedMedia, 'url' | 'type' | 'data'>;

// concurrent tiles sharing a url share one request; every settled promise is
// removed, so a later mount can retry after a transient failure
const inFlight = new Map<string, Promise<ResolvedRemoteImage | undefined>>();

export async function resolveRemoteImage(
  url: string,
  cacheRemoteImage: boolean
): Promise<ResolvedRemoteImage | undefined> {
  const cached = await getCachedImage(url);
  if (cached) return cached;
  if (!cacheRemoteImage || !navigator.onLine) return undefined;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = fetchAndCache(url);
  inFlight.set(url, request);

  try {
    return await request;
  } finally {
    inFlight.delete(url);
  }
}

async function fetchAndCache(
  url: string
): Promise<ResolvedRemoteImage | undefined> {
  try {
    // the <img> already pulled this url, so prefer the browser's copy over a
    // revalidating round trip; symbol images are immutable, a stale hit is fine
    const response = await fetch(url, { cache: 'force-cache' });
    const type = response.headers.get('content-type') || '';
    // captive portals answer 200 with their own HTML: caching that would poison
    // this url forever, since a cache hit never re-fetches
    if (!response.ok || !type.startsWith('image/')) return undefined;

    const data = await response.arrayBuffer();
    const image = { url, type, data };
    await putCachedImage(image);
    return image;
  } catch (error) {
    return undefined;
  }
}
