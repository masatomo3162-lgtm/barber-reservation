const CACHE_NAME = 'barber-app-v1.0.3-20260708a';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './manifest.json',
  './reservation-favicon.ico',
  './reservation-favicon-16.png',
  './reservation-favicon-32.png',
  './reservation-icon.svg',
  './reservation-apple-touch-icon.png',
  './reservation-icon-192.png',
  './reservation-icon-512.png',
  './reservation-icon-512-maskable.png',
  './favicon.ico',
  './favicon-16.png',
  './favicon-32.png',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './js/db.js',
  './js/app.js',
];
const FULLCALENDAR_URL = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL_ASSETS);
    try {
      await cache.add(FULLCALENDAR_URL);
    } catch (error) {
      console.warn('FullCalendarの事前キャッシュをスキップしました', error);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('./index.html');
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && new URL(request.url).protocol.startsWith('http')) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const path = url.pathname;
  const shouldNetworkFirst = event.request.mode === 'navigate' ||
    path.endsWith('/index.html') ||
    path.endsWith('/js/app.js') ||
    path.endsWith('/js/db.js') ||
    path.endsWith('/manifest.webmanifest') ||
    path.endsWith('/manifest.json');
  event.respondWith(shouldNetworkFirst ? networkFirst(event.request) : cacheFirst(event.request));
});
