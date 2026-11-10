// Template: `bun scripts/build-sw.ts` writes public/sw.js with the build id.
const BUILD_ID = '__BUILD_ID__'
const OFFLINE_URL = '/offline.html'
const CACHE_PREFIX = 'verdict'
const ORIGIN = self.location.origin

// Workbox is loaded defensively: if the CDN is unavailable or blocked, the
// worker must still install so the app stays installable. Only the caching
// layer is lost, and the browser falls back to the network as usual.
try {
  importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js')
} catch (error) {
  console.warn('verdict: Workbox unavailable, caching disabled', error)
}

// Caching is disabled on local development hosts. The worker can still be
// registered, but its runtime caches must not interfere with HMR or dev assets.
const isLocalDev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname)

if (typeof workbox !== 'undefined' && !isLocalDev) {
  workbox.core.setCacheNameDetails({
    prefix: CACHE_PREFIX,
    suffix: BUILD_ID,
    precache: 'precache',
    runtime: 'runtime',
  })

  workbox.precaching.precacheAndRoute(self.__WB_MANIFEST || [])

  // API and SSE traffic is never cached. Runs stream from the API origin, and
  // a cached event or JSON response would replay stale results.
  workbox.routing.registerRoute(
    ({ url }) =>
      url.origin !== ORIGIN ||
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/runs'),
    new workbox.strategies.NetworkOnly(),
  )

  // Navigations are network-first, so a deploy is picked up immediately and the
  // offline page is served only when the network is unreachable.
  workbox.routing.registerRoute(
    ({ request }) => request.mode === 'navigate',
    new workbox.strategies.NetworkFirst({
      cacheName: `${CACHE_PREFIX}-pages`,
      networkTimeoutSeconds: 5,
      plugins: [
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 40,
          maxAgeSeconds: 30 * 24 * 60 * 60,
        }),
      ],
    }),
  )

  // Same-origin images only. Cross-origin opaque responses are left to the
  // browser, which avoids reporting cached images as failed loads.
  workbox.routing.registerRoute(
    ({ request, url }) => request.destination === 'image' && url.origin === ORIGIN,
    new workbox.strategies.CacheFirst({
      cacheName: `${CACHE_PREFIX}-images`,
      plugins: [
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 80,
          maxAgeSeconds: 30 * 24 * 60 * 60,
        }),
      ],
    }),
  )

  // Styles and scripts stay usable offline while the next version downloads.
  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'style' || request.destination === 'script',
    new workbox.strategies.StaleWhileRevalidate({
      cacheName: `${CACHE_PREFIX}-assets`,
      plugins: [
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 60,
          maxAgeSeconds: 7 * 24 * 60 * 60,
        }),
      ],
    }),
  )

  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'font',
    new workbox.strategies.CacheFirst({
      cacheName: `${CACHE_PREFIX}-fonts`,
      plugins: [
        new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 20,
          maxAgeSeconds: 365 * 24 * 60 * 60,
        }),
      ],
    }),
  )

  workbox.routing.setCatchHandler(async ({ request }) => {
    if (request.mode === 'navigate') {
      return (await caches.match(OFFLINE_URL)) || Response.error()
    }
    return Response.error()
  })
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(`${CACHE_PREFIX}-offline-v1`)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch((error) => console.warn('verdict: offline precache skipped', error)),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter(
            (name) =>
              name.startsWith(`${CACHE_PREFIX}-`) &&
              name !== `${CACHE_PREFIX}-offline-v1` &&
              !name.endsWith(`-${BUILD_ID}`),
          )
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

// The page posts this when the user accepts the update prompt.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

// Chrome requires a fetch handler for the app to be installable. Workbox adds
// its own routes in production; this no-op keeps the worker installable when
// the caching layer is disabled on a dev host.
self.addEventListener('fetch', (event) => {
  void event
})
