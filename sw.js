// Service worker : met l'application en cache pour qu'elle fonctionne hors ligne.
const CACHE = 'arbre-familial-v3';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'tree.js', 'cloud.js', 'config.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Réseau d'abord (pour recevoir les mises à jour), cache en secours.
// Seuls les fichiers du site et la bibliothèque Firebase sont mis en cache : les échanges
// avec la base de données passent directement (Firestore gère lui-même le hors-ligne).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const cacheable = url.origin === location.origin || url.href.startsWith('https://www.gstatic.com/firebasejs/');
  if (e.request.method !== 'GET' || !cacheable) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
