// ---------------------------------------------------------------------------
// Offline map tiles.
//
// Tiles come from CARTO over the network, so a run somewhere without signal
// draws the accent polyline on a blank background — exactly where a map is most
// wanted. Every tile the app has already displayed is kept in a Cache Storage
// bucket and served from there first, which means the roads you run on are
// available offline after the first time you look at them.
//
// Cache Storage rather than IndexedDB because the values are Responses, it
// works identically in the browser and the Android WebView, and it is evicted
// by the platform under storage pressure rather than growing forever.
//
// Nothing here is required for the map to work: every failure path falls back
// to the plain network URL that Leaflet would have used anyway.
// ---------------------------------------------------------------------------

const CACHE_NAME = "stride-tiles-v1";

/** Roughly a fortnight of running around the same streets. */
export const MAX_TILES = 900;

const supported = () => typeof caches !== "undefined" && typeof Request !== "undefined";

let cachePromise = null;
const openCache = () => {
  if (!supported()) return Promise.resolve(null);
  cachePromise = cachePromise || caches.open(CACHE_NAME).catch(() => null);
  return cachePromise;
};

/**
 * Fetch a tile, preferring the cached copy.
 *
 * Returns an object URL for the tile image, or null when it cannot be had at
 * all — the caller then leaves Leaflet to its own network request.
 */
export async function loadTile(url, { signal } = {}) {
  const cache = await openCache();

  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return URL.createObjectURL(await hit.blob());
    } catch { /* fall through to the network */ }
  }

  let res;
  try {
    res = await fetch(url, { signal, mode: "cors" });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  // Cache a clone before the body is consumed, and never let a cache write
  // failure (quota, private mode) stop the tile being displayed.
  if (cache) {
    cache.put(url, res.clone()).catch(() => {});
    trim(cache);
  }

  try {
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

// Cache Storage has no size limit of its own, so keep it bounded. Oldest-first
// is close enough: entries go in in the order they were first displayed.
let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_TILES) {
      const excess = keys.slice(0, keys.length - MAX_TILES);
      await Promise.all(excess.map((k) => cache.delete(k).catch(() => {})));
    }
  } catch { /* nothing to trim */ } finally {
    trimming = false;
  }
}

export async function tileCacheSize() {
  const cache = await openCache();
  if (!cache) return 0;
  try { return (await cache.keys()).length; } catch { return 0; }
}

export async function clearTileCache() {
  cachePromise = null;
  if (!supported()) return false;
  try { return await caches.delete(CACHE_NAME); } catch { return false; }
}

/**
 * A Leaflet TileLayer subclass that goes through the cache.
 *
 * Leaflet is passed in rather than imported so this module stays free of the
 * mapping dependency and testable on its own.
 */
export function cachedTileLayer(L, url, options = {}) {
  const Layer = L.TileLayer.extend({
    createTile(coords, done) {
      const img = document.createElement("img");
      img.alt = "";
      const src = this.getTileUrl(coords);

      let objectUrl = null;
      const revoke = () => { if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; } };

      img.onload = () => { done(null, img); };
      img.onerror = () => { revoke(); done(new Error("tile failed"), img); };
      // Leaflet removes tiles as you pan; release the blob with them.
      L.DomEvent.on(img, "remove", revoke);

      loadTile(src).then((blobUrl) => {
        if (blobUrl) { objectUrl = blobUrl; img.src = blobUrl; }
        else img.src = src;   // last resort: let the browser try directly
      });

      return img;
    },
  });
  return new Layer(url, options);
}
