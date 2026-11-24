const CACHE_NAME = 'today-weather-shell-v17';
const RUNTIME_CACHE_NAME = 'today-weather-runtime-v1';
const MAX_RUNTIME_ENTRIES = 120;
const MAX_CACHED_IMAGES = 45;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
const NETWORK_TIMEOUT_MS = 12000;
const NAVIGATION_TIMEOUT_MS = 18000;
const CACHEABLE_EXTERNAL_HOSTS = new Set([
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'cdn.jsdelivr.net'
]);

const APP_SHELL = [
    './index.html',
    './sitemap.html',
    './manifest.webmanifest',
    './assets/css/style-main.css',
    './assets/css/city-pages.css',
    './assets/css/sitemap.css',
    './assets/js/core.js',
    './assets/js/geo-service.js',
    './assets/js/weather-service.js',
    './assets/js/weather-tips-engine.js',
    './data/weather-tips.json',
    './assets/js/ui.js',
    './assets/js/map-service.js',
    './assets/js/search-news.js',
    './assets/js/global-search.js',
    './data/global-search-index.json',
    './assets/js/effects.js',
    './assets/js/image-loader.js',
    './assets/js/specialized-weather.js',
    './assets/js/app.js',
    './assets/js/adsData.js',
    './assets/images/icon1.webp'
];

let cacheWriteQueue = Promise.resolve();

function withTimeout(request, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(request, { signal: controller.signal })
        .then(response => {
            // Stop the network timer as soon as headers arrive. Keeping it alive
            // during Cache.put() can abort the response body while it is being stored.
            clearTimeout(timeoutId);
            return response;
        })
        .catch(error => {
            clearTimeout(timeoutId);
            throw error;
        });
}

function isCacheableResponse(request, response) {
    if (!response || response.status !== 200 || response.type === 'opaque') return false;
    if (request.method !== 'GET' || request.headers.has('authorization')) return false;
    const cacheControl = response.headers.get('cache-control') || '';
    if (/\b(no-store|private)\b/i.test(cacheControl)) return false;
    if (response.headers.get('vary') === '*') return false;

    const url = new URL(request.url);
    const isImage = request.destination === 'image' || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > (isImage ? MAX_IMAGE_BYTES : MAX_RESOURCE_BYTES)) return false;
    return true;
}

function isImageRequest(request) {
    const url = new URL(request.url);
    return request.destination === 'image' || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname);
}

async function trimRuntimeCache(cache) {
    const keys = await cache.keys();
    const imageKeys = keys.filter(isImageRequest);
    const removeOldest = async (items, maximum) => {
        const excess = items.length - maximum;
        for (let index = 0; index < excess; index++) {
            await cache.delete(items[index]);
        }
    };
    await removeOldest(imageKeys, MAX_CACHED_IMAGES);
    const remaining = await cache.keys();
    await removeOldest(remaining, MAX_RUNTIME_ENTRIES);
}

function queueCacheWrite(cache, request, response) {
    cacheWriteQueue = cacheWriteQueue
        .then(async () => {
            await cache.put(request, response);
            await trimRuntimeCache(cache);
        })
        .catch(error => {
            console.warn('[PWA] Cache write skipped:', request.url, error);
        });
    return cacheWriteQueue;
}

async function precacheAppShell(cache) {
    let nextIndex = 0;
    const workerCount = Math.min(3, APP_SHELL.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < APP_SHELL.length) {
            const asset = APP_SHELL[nextIndex++];
            try {
                const response = await withTimeout(
                    new Request(asset, { cache: 'reload' }),
                    NETWORK_TIMEOUT_MS
                );
                if (response.ok) {
                    await cache.put(asset, response);
                } else {
                    console.warn('[PWA] Precache skipped:', asset, response.status);
                }
            } catch (error) {
                console.warn('[PWA] Precache failed:', asset, error);
            }
        }
    });
    await Promise.all(workers);
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await precacheAppShell(cache);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter(key => key.startsWith('today-weather-') &&
                key !== CACHE_NAME && key !== RUNTIME_CACHE_NAME)
            .map(key => caches.delete(key)));
        await caches.open(RUNTIME_CACHE_NAME);
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;
    const externalStatic = !sameOrigin && CACHEABLE_EXTERNAL_HOSTS.has(url.hostname);
    if (!sameOrigin && !externalStatic) return;
    // Avoid caching query-string variants such as cache-busters and tracking URLs.
    if (sameOrigin && url.search) return;

    event.respondWith((async () => {
        const cacheName = sameOrigin ? RUNTIME_CACHE_NAME : CACHE_NAME;
        const cache = await caches.open(cacheName);
        const cached = await cache.match(request);

        if (externalStatic && cached) return cached;

        const timeoutMs = request.mode === 'navigate' || request.destination === 'document'
            ? NAVIGATION_TIMEOUT_MS
            : NETWORK_TIMEOUT_MS;

        try {
            const response = await withTimeout(request, timeoutMs);
            if (isCacheableResponse(request, response)) {
                // The timeout has already been cleared before the response is
                // cloned or written, preventing Cache.put() body cancellation.
                const clone = response.clone();
                void queueCacheWrite(cache, request, clone);
            }
            return response;
        } catch (error) {
            if (cached) return cached;
            if (request.mode === 'navigate') {
                const shell = await (await caches.open(CACHE_NAME)).match('./index.html');
                if (shell) return shell;
            }
            return new Response('', {
                status: 503,
                statusText: error?.name === 'AbortError' ? 'Network timeout' : 'Network unavailable',
                headers: { 'Cache-Control': 'no-store' }
            });
        }
    })());
});
