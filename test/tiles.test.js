import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A minimal Cache Storage stand-in. Insertion order stands in for age, which
// is what the real trim relies on.
function makeCaches() {
  const store = new Map();
  const cache = {
    match: vi.fn(async (url) => store.get(url) || undefined),
    put: vi.fn(async (url, res) => { store.set(url, res); }),
    keys: vi.fn(async () => [...store.keys()]),
    delete: vi.fn(async (url) => store.delete(url)),
  };
  return { caches: { open: vi.fn(async () => cache), delete: vi.fn(async () => true) }, cache, store };
}

const body = (name) => ({
  ok: true,
  clone() { return this; },
  blob: async () => `blob:${name}`,
});

let env;
beforeEach(async () => {
  vi.resetModules();
  env = makeCaches();
  globalThis.caches = env.caches;
  globalThis.Request = class {};
  globalThis.URL.createObjectURL = vi.fn((b) => `object:${b}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  delete globalThis.caches;
  delete globalThis.Request;
  vi.restoreAllMocks();
});

const load = () => import("../src/tiles.js");

describe("loadTile", () => {
  it("serves a cached tile without touching the network", async () => {
    const { loadTile } = await load();
    env.store.set("https://tiles/1.png", body("cached"));
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const url = await loadTile("https://tiles/1.png");
    expect(url).toBe("object:blob:cached");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches and then caches a tile it has not seen", async () => {
    const { loadTile } = await load();
    globalThis.fetch = vi.fn(async () => body("fresh"));

    const url = await loadTile("https://tiles/2.png");
    expect(url).toBe("object:blob:fresh");
    expect(env.cache.put).toHaveBeenCalledWith("https://tiles/2.png", expect.anything());
  });

  it("returns null when the tile cannot be had, so Leaflet can try itself", async () => {
    const { loadTile } = await load();
    globalThis.fetch = vi.fn(async () => { throw new Error("offline"); });
    expect(await loadTile("https://tiles/3.png")).toBeNull();

    globalThis.fetch = vi.fn(async () => ({ ok: false }));
    expect(await loadTile("https://tiles/4.png")).toBeNull();
  });

  it("still shows a tile when the cache write fails", async () => {
    // A full or blocked cache must not cost you the map.
    const { loadTile } = await load();
    env.cache.put.mockRejectedValue(new Error("quota"));
    globalThis.fetch = vi.fn(async () => body("fresh"));
    expect(await loadTile("https://tiles/5.png")).toBe("object:blob:fresh");
  });

  it("falls back to the network when the cache cannot even be read", async () => {
    const { loadTile } = await load();
    env.cache.match.mockRejectedValue(new Error("broken"));
    globalThis.fetch = vi.fn(async () => body("fresh"));
    expect(await loadTile("https://tiles/6.png")).toBe("object:blob:fresh");
  });

  it("works with no Cache Storage at all", async () => {
    delete globalThis.caches;
    const { loadTile } = await load();
    globalThis.fetch = vi.fn(async () => body("fresh"));
    expect(await loadTile("https://tiles/7.png")).toBe("object:blob:fresh");
  });
});

describe("trimming", () => {
  it("keeps the cache bounded, dropping the oldest entries", async () => {
    const { loadTile, MAX_TILES } = await load();
    for (let i = 0; i < MAX_TILES + 5; i++) env.store.set(`https://tiles/old-${i}.png`, body(i));
    globalThis.fetch = vi.fn(async () => body("new"));

    await loadTile("https://tiles/new.png");
    // give the fire-and-forget trim a turn
    await new Promise((r) => setTimeout(r, 0));

    expect(env.store.size).toBeLessThanOrEqual(MAX_TILES + 1);
    // the oldest went first
    expect(env.store.has("https://tiles/old-0.png")).toBe(false);
    expect(env.store.has("https://tiles/new.png")).toBe(true);
  });
});

describe("tileCacheSize / clearTileCache", () => {
  it("reports how many tiles are held", async () => {
    const { tileCacheSize } = await load();
    env.store.set("a", body("a"));
    env.store.set("b", body("b"));
    expect(await tileCacheSize()).toBe(2);
  });

  it("reports zero rather than throwing without Cache Storage", async () => {
    delete globalThis.caches;
    const { tileCacheSize, clearTileCache } = await load();
    expect(await tileCacheSize()).toBe(0);
    expect(await clearTileCache()).toBe(false);
  });

  it("clears the bucket", async () => {
    const { clearTileCache } = await load();
    expect(await clearTileCache()).toBe(true);
    expect(env.caches.delete).toHaveBeenCalled();
  });
});
