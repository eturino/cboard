import { CachedMedia, dbPromise } from './db';

export type { CachedMedia };

// callers cache an image, they don't decide when it was last used
export type ImageToCache = Omit<CachedMedia, 'lastUsed'>;

const TOTAL_BYTES_KEY = 'totalBytes';

// a write per render would cost more than the eviction order is worth, so age the
// timestamp coarsely: a symbol used at all today is as recent as any other
const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;

export async function getCachedImage(
  url: string
): Promise<CachedMedia | undefined> {
  try {
    const db = await dbPromise;
    const cached = await db.get('cached', url);

    if (cached && Date.now() - cached.lastUsed > TOUCH_AFTER_MS) {
      // don't make the hit wait on a write that rewrites the whole record. The
      // transaction is created before this returns, so it still lands ahead of
      // any eviction the caller goes on to trigger.
      db.put('cached', { ...cached, lastUsed: Date.now() }).catch((error) => {
        // a failed touch costs eviction order, not the hit we already have
        console.error('Failed to touch cached image:', error);
      });
    }

    return cached;
  } catch (error) {
    console.error('Failed to read cached image:', error);
    return undefined;
  }
}

const MAX_CACHE_BYTES = 250 * 1024 * 1024;
const MAX_QUOTA_SHARE = 0.1;
// free some headroom when evicting, so a full cache doesn't evict on every write
const EVICT_TO_SHARE = 0.95;

const warned = new Set<string>();

// Boards are the only irreplaceable thing in this origin and they are tiny (~100s
// of KB), so an unbounded image cache would be the whole storage footprint. The
// absolute cap is what enforces that: storage.estimate() only lowers it, and is
// missing on iOS 16 and old Android WebViews. The browser grants quota out of free
// disk, so taking a share of it self-limits on a device with little space left.
async function readBudget(): Promise<number> {
  try {
    const { quota } = (await navigator.storage?.estimate?.()) ?? {};
    return quota
      ? Math.min(MAX_CACHE_BYTES, quota * MAX_QUOTA_SHARE)
      : MAX_CACHE_BYTES;
  } catch (error) {
    return MAX_CACHE_BYTES;
  }
}

// the quota moves with free disk, far too slowly to be worth an estimate() call
// per cached image
let budgetPromise: Promise<number> | null = null;

function budgetBytes(): Promise<number> {
  if (!budgetPromise) budgetPromise = readBudget();
  return budgetPromise;
}

function warnOnce(key: string, message: string): void {
  // uncached symbols silently stop working offline, which is invisible from the
  // ui, so say it once rather than per image
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

// The cache tracks its own byte total rather than reading storage.estimate().usage,
// which counts everything in the origin, boards included. Eviction is by last use,
// not by whether a board still references the image: a symbol on a board nobody has
// opened in a long time can be dropped, and only shows up as a missing image when
// that board is next opened offline.
export async function putCachedImage(image: ImageToCache): Promise<void> {
  try {
    const db = await dbPromise;
    // outside the transaction: awaiting a non-idb promise inside it commits it early
    const budget = await budgetBytes();

    if (image.data.byteLength > budget) {
      warnOnce(
        'oversized',
        `Image too large to cache (${image.data.byteLength} bytes, budget is ` +
          `${budget}); it will load from the network only.`
      );
      return;
    }

    const tx = db.transaction(['cached', 'meta'], 'readwrite');
    const cached = tx.objectStore('cached');
    const used = (await tx.objectStore('meta').get(TOTAL_BYTES_KEY)) ?? 0;
    // an already cached url is replaced, not added, so only the delta counts
    const replaced = (await cached.get(image.url))?.data.byteLength ?? 0;
    let total = used - replaced + image.data.byteLength;

    if (total > budget) {
      warnOnce(
        'full',
        `Image cache full (${budget} bytes); evicting least recently used ` +
          'symbols, which will load from the network only.'
      );

      // walk to the end rather than stopping at the low water mark: summing
      // what survives makes the stored total exact, so a meta value that has
      // drifted from the store corrects itself here instead of persisting
      let survived = 0;
      let cursor = await cached.index('byLastUsed').openCursor();
      while (cursor) {
        // the image being written is counted below, already here or not
        if (cursor.value.url !== image.url) {
          if (total > budget * EVICT_TO_SHARE) {
            total -= cursor.value.data.byteLength;
            await cursor.delete();
          } else {
            survived += cursor.value.data.byteLength;
          }
        }
        cursor = await cursor.continue();
      }
      total = survived + image.data.byteLength;
    }

    await cached.put({ ...image, lastUsed: Date.now() });
    await tx.objectStore('meta').put(total, TOTAL_BYTES_KEY);
    await tx.done;
  } catch (error) {
    console.error('Failed to cache image:', error);
  }
}
