const CACHE = 'tacto-pilot-v6';
const ASSETS = ['./', './index.html', './lang-boot.js', './styles.css', './studio.css', './feedback-controls.css', './app.js', './i18n.js', './scenes.js', './missions.js', './feedback.js', './studio.js', './custom-scene.js', './image-analysis.js', './narration.js', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tacto-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const narration = url.pathname.startsWith(new URL('./audio/', self.location).pathname) && url.pathname.endsWith('.wav');
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || (!narration && !ASSETS.some(asset => new URL(asset, self.location).pathname === url.pathname))) return;
  // Never cache authentication redirects or a private hosting login page.
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && !response.redirected && response.type === 'basic') caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  // ignoreSearch: the same page is opened as ./, ./?lang=en or ./?lang=es.
  }).catch(() => caches.match(event.request, { ignoreSearch: true }).then(cached => cached || Response.error())));
});
