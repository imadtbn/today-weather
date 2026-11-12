const CACHE_NAME = 'today-weather-shell-v4';
const APP_SHELL = ['./index.html','./manifest.webmanifest','./assets/css/style-main.css','./assets/js/core.js','./assets/js/geo-service.js','./assets/js/weather-service.js','./assets/js/weather-tips-engine.js','./data/weather-tips.json','./assets/js/ui.js','./assets/js/map-service.js','./assets/js/search-news.js','./assets/js/effects.js','./assets/js/specialized-weather.js','./assets/js/app.js','./assets/js/adsData.js','./assets/images/icon1.webp'];
const STATIC_EXTERNAL_HOSTS = new Set(['cdnjs.cloudflare.com','unpkg.com','cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com']);
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(APP_SHELL.map(async asset => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetch(asset, { cache: 'reload', signal: controller.signal });
                if (response.ok) await cache.put(asset, response);
                else console.warn('[PWA] Precache skipped:', asset, response.status);
            } catch (error) {
                console.warn('[PWA] Precache failed:', asset, error);
            } finally {
                clearTimeout(timeoutId);
            }
        }));
        await self.skipWaiting();
    })());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('today-weather-')&&key!==CACHE_NAME).map(key=>caches.delete(key)));await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url),sameOrigin=url.origin===self.location.origin,externalStatic=!sameOrigin&&STATIC_EXTERNAL_HOSTS.has(url.hostname);
 if(!sameOrigin&&!externalStatic)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE_NAME),cached=await cache.match(request);
  if(externalStatic&&cached)return cached;
  const controller=new AbortController(),timeoutId=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch(request,{signal:controller.signal});if(response&&(response.ok||response.type==='opaque')){try{await cache.put(request,response.clone());}catch(cacheError){console.warn('[PWA] Cache write failed:',request.url,cacheError);}}return response;}
  catch(error){if(cached)return cached;if(request.mode==='navigate'){const shell=await cache.match('./index.html');if(shell)return shell;}throw error;}
  finally{clearTimeout(timeoutId);}
 })());
});
