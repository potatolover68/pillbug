/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { APP_CACHE } from "./cache/names";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision?: string }>;
};

const manifest = self.__WB_MANIFEST;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await Promise.all(
        manifest.map((entry) => {
          const url = typeof entry === "string" ? entry : entry.url;
          return cache.add(url).catch(() => undefined);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

clientsClaim();

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache the wiki proxy — always hit the live server.
  if (
    url.origin === self.location.origin &&
    (url.pathname === "/healthz" ||
      url.pathname === "/w/api.php" ||
      url.pathname.startsWith("/w/rest.php"))
  ) {
    return;
  }
  if (event.request.method !== "GET") return;
  event.respondWith(handleFetch(event.request));
});

async function handleFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const appCache = await caches.open(APP_CACHE);
        await appCache.put(request, response.clone());
      }
      return response;
    } catch {
      const appCache = await caches.open(APP_CACHE);
      const fallback = await appCache.match(request);
      if (fallback) return fallback;
      return Response.error();
    }
  }

  return fetch(request);
}
