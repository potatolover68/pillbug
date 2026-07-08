import { PACK_CACHE } from "../cache/names";

export async function cachePackUrl(url: string): Promise<void> {
  const cache = await caches.open(PACK_CACHE);
  await cache.add(url);
}

export async function uncachePackUrl(url: string): Promise<void> {
  const cache = await caches.open(PACK_CACHE);
  await cache.delete(url);
}
