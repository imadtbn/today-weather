const CACHE_NAME = 'today-weather-shell-v1';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './assets/css/style-main.css',
    './assets/js/core.js',
    './assets/js/geo-service.js',
    './assets/js/weather-service.js',
    './assets/js/ui.js',
    './assets/js/map-service.js',
    './assets/js/search-news.js',
    './assets/js/effects.js',
    './assets/js/app.js',
    './assets/js/adsData.js',
    './assets/images/icon1.webp'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_SHELL);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith('today-weather-') && key !== CACHE_NAME)
            .map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(request, { signal: controller.signal });
            if (response && response.ok) await cache.put(request, response.clone());
            return response;
        } catch (error) {
            const cached = await cache.match(request);
            if (cached) return cached;
            if (request.mode === 'navigate') {
                const shell = await cache.match('./index.html');
                if (shell) return shell;
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    })());
});
