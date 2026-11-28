// Home OS service worker.
// Bump VERSION every release. This worker only ever deletes caches it owns (homeos-*).
// Other apps on this origin keep their own caches and storage untouched.
const VERSION = 'homeos-shell-v11';
const FONTS = 'homeos-fonts-v1';
const OWN = [VERSION, FONTS];
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest',
  'css/app.css', 'js/boot.js', 'js/app.js', 'js/api.js', 'js/particles.js', 'js/realtime.js', 'js/schedule.js', 'js/day.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/apple-touch-icon-blush.png', 'icons/apple-touch-icon-roast.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache (GitHub Pages says max-age=600),
  // so a new version never gets filled with the old files.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('homeos-') && !OWN.includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fonts: cache first.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Only our own files, inside our own scope. Supabase and everything else pass through.
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  // App shell: serve from cache, refresh in the background (stale-while-revalidate).
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const hit = await c.match(key, { ignoreSearch: req.mode === 'navigate' });
    // Always check with the server in the background, never the browser's HTTP cache.
    const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
    const net = fetch(fresh).then((res) => {
      if (res.ok && res.type === 'basic') c.put(key, res.clone());
      return res;
    }).catch(() => hit || Response.error());
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
