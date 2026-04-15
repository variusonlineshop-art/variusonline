self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open('v1').then((cache) => cache.addAll([
      '/',
      '/login.html',
      '/manifest.json',
      // Agrega aquí tus recursos principales (JS, CSS, imágenes...)
    ]))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});