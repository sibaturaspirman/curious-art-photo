// Service worker: makes the app installable ("Add to Home screen") and keeps it opening fast.
// - App files are cached on install; everything else (MediaPipe wasm, models, fonts) is cached the
//   first time it is used.
// - Files are served from the cache and refreshed in the background, so an update shows up on the
//   next launch. Bump VERSION after changing files to drop the old cache right away.
// - Uploads go to the engagement API on another origin and are never cached.
const VERSION = 'v17';
const CACHE = `curious-art-${VERSION}`;
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.json', 'config.js',
  'glitch.js', 'glitch-video.js', 'outline.js', 'loading.js', 'app.js', 'bg-glitch.js',
  'assets/bg-portrait.webp', 'assets/glitch-cluster.webp', 'assets/logo-iqos-keyhole.png',
  'assets/vendor/qrcode.min.js', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('curious-art-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.headers.has('range')) return; // video seeking: let the browser talk to the server directly

  event.respondWith(caches.open(CACHE).then(async cache => {
    // The page URL carries ?frame=0 etc.; match the cached file regardless of the query.
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const fresh = fetch(req).then(res => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    });
    if (cached) { fresh.catch(() => {}); return cached; }
    return fresh;
  }));
});
