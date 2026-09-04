import { getCachedImage, putCachedImage } from './imageCache';

const handled = new Set<string>();

export async function storeRemoteImage(url: string): Promise<void> {
  if (handled.has(url) || !navigator.onLine) return;
  handled.add(url);

  try {
    if (await getCachedImage(url)) return;
    const response = await fetch(url);
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.startsWith('image/')) return;

    await putCachedImage({ url, type, data: await response.arrayBuffer() });
  } catch (error) {
    handled.delete(url);
  }
}
