/* sw.js — offline cache for the Fiwo site.
 *
 * Two reasons this exists, and only the second is about being offline:
 *
 *  1. The site is a single 400 KB page plus ~1.5 MB of generated data. Once
 *     cached it opens instantly, which matters on a phone on mobile data.
 *
 *  2. INSTALLABILITY. A site with a manifest and a service worker can be
 *     installed to the home screen, and an installed app is exempt from
 *     Safari's 7-day cap on script-writable storage — the cap that would
 *     otherwise quietly delete a reader's progress (see fiwo-store.js). Chrome
 *     also grants navigator.storage.persist() automatically to installed apps.
 *     So this file is, indirectly, what makes on-device progress trustworthy.
 *
 * Strategy, deliberately simple because there is no build step and no server
 * logic to coordinate with:
 *
 *   navigation  → network first, cache as fallback. The reader should get the
 *                 current site when they have signal; a cached page that is a
 *                 week stale is only correct when the network is not there.
 *   same-origin → stale-while-revalidate. Serve the cached copy at once, then
 *   assets        refresh it in the background for next time. Everything here
 *                 is generated and versioned by a ?v= query, so a stale copy is
 *                 never wrong for long and never blocks a paint.
 *   cross-origin→ untouched. The Google Fonts stylesheet and the analytics
 *                 beacon have their own caching and are not ours to manage.
 *
 * BUMP CACHE_VERSION when the precache list changes. Old caches are deleted on
 * activate, so a bad deploy is one version bump away from being flushed.
 */

const CACHE_VERSION = 'fiwo-v6';

/* The shell: enough to open the site with no network at all. The heavy data
 * files (stories.js, DerivedDictionary.js) are deliberately NOT precached —
 * they are ~1 MB between them and most visits never touch both, so they are
 * cached on first use instead of taxing every install. */
const SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './fiwo-store.js',
  // In the shell, not cached on first use: it is what restores a wiped browser
  // from the reader's own file, so it has to be there on the visit where
  // everything else has gone.
  './fiwo-backup.js',
  './fiwo-parser.js',
  // The course is 237 KB of its own now that it is no longer inside index.html
  // — but the workbook is the site's spine, and "open the lesson you were on"
  // has to work on a train. Precached for the same reason the shell is.
  './workbook.js',
  './workbook-page.js',
  './fiwo-pronounce.js',
  './dictionary.js',
  './icon.svg',
  './icon-192.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll() is atomic: one 404 and nothing is cached. The shell is small and
    // fixed, but a renamed file should not silently leave the app uninstallable,
    // so each entry is added independently and failures are reported.
    await Promise.all(SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] could not precache', url, err);
      }
    }));
    // Take over as soon as possible rather than waiting for every tab to close.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(n => n.startsWith('fiwo-') && n !== CACHE_VERSION)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // fonts, analytics: not ours

  // Navigations: network first, so a reader with signal always gets the live site.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html'))
            || (await caches.match('./'))
            || Response.error();
      }
    })());
    return;
  }

  // Assets: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const hit = await cache.match(request);
    const network = fetch(request).then((response) => {
      // Opaque and error responses must not be cached: an opaque 404 from a
      // typo would be served forever as if it were the real file.
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);

    if (hit) return hit;
    const fresh = await network;
    if (fresh) return fresh;

    /* Offline, with nothing cached at this exact URL.
     *
     * The shell is precached as `style.css`, but the page asks for
     * `style.css?v=24` — cache matching includes the query string, so those are
     * different entries and a first-ever offline load would have come up
     * unstyled. Retrying with ignoreSearch accepts a differently-versioned copy.
     *
     * Deliberately the LAST resort, after both the exact hit and the network:
     * the ?v= param exists precisely to defeat stale caches, so ignoring it is
     * only correct when the alternative is showing nothing at all. */
    return (await cache.match(request, { ignoreSearch: true })) || Response.error();
  })());
});
