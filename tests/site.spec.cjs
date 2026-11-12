const { test, expect } = require('@playwright/test');

test('homepage exposes valid SEO and PWA metadata', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://imadtbn.github.io/today-weather/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  const data = await page.evaluate(async () => {
    const manifest = await fetch('./manifest.webmanifest').then(r => r.json());
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      display: manifest.display,
      direction: manifest.dir,
      icon: manifest.icons?.[0]?.src
    };
  });
  expect(data.title.length).toBeGreaterThan(15);
  expect(data.description.length).toBeGreaterThan(60);
  expect(data.display).toBe('standalone');
  expect(data.direction).toBe('rtl');
  expect(data.icon).toBe('assets/images/icon1.webp');
});

test('mobile navigation is immediately interactive and accessible', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const button = page.locator('#mobileMenuBtn');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#mainNav')).toHaveClass(/active/);
});

test('header remains available after scrolling down', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.locator('#siteHeader')).not.toHaveClass(/hidden/);
  await expect(page.locator('#searchInput')).toBeVisible();
});

test('city search supports accessible keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const input = page.locator('#searchInput');
  await input.fill('وهران');
  const option = page.getByRole('option', { name: /وهران/ });
  await expect(option).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await input.press('ArrowDown');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute('aria-activedescendant', await option.getAttribute('id'));
  await input.press('Escape');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
});

test('layout has no horizontal page overflow on common screen widths', async ({ page }) => {
  for (const width of [320, 360, 390, 430, 768, 1024]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      offenders: [...document.body.querySelectorAll('*')].map(el => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { tag: el.tagName, id: el.id, className: typeof el.className === 'string' ? el.className : '', left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), position: style.position };
      }).filter(x => x.width > 0 && (x.left < -1 || x.right > innerWidth + 1) && x.position !== 'fixed').slice(0, 12)
    }));
    expect(metrics.document, 'document overflow at viewport ' + width + ': ' + JSON.stringify(metrics.offenders)).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.body, 'body overflow at viewport ' + width + ': ' + JSON.stringify(metrics.offenders)).toBeLessThanOrEqual(metrics.viewport + 1);
  }
});

test('service worker precaches the app shell for offline use', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem('algeria_weather_location_v2', JSON.stringify({
      data: { lat: 36.752887, lon: 3.042048, name: 'الجزائر العاصمة', state: 'الجزائر العاصمة', country: 'الجزائر', displayName: 'الجزائر العاصمة / الجزائر' },
      timestamp: Date.now()
    }));
  });
  await page.route('https://api.openweathermap.org/**', route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const diagnostic = await page.evaluate(async () => {
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    await new Promise(resolve => setTimeout(resolve, 3000));
    const cacheNames = await caches.keys();
    const cacheInfo = await Promise.all(cacheNames.map(async name => ({
      name,
      urls: (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)
    })));
    return {
      active: registration.active?.state || null,
      installing: registration.installing?.state || null,
      waiting: registration.waiting?.state || null,
      caches: cacheInfo
    };
  });
  console.log('[PWA diagnostic]', JSON.stringify(diagnostic));
  expect(diagnostic.active, 'service worker activation state: ' + JSON.stringify(diagnostic)).toBe('activated');
  const shellCache = diagnostic.caches.find(cache => cache.name.startsWith('today-weather-shell-'));
  expect(shellCache, 'PWA shell cache was not created').toBeTruthy();
  const cachedPaths = shellCache.urls;
  for (const path of ['/index.html', '/assets/css/style-main.css', '/assets/js/app.js', '/manifest.webmanifest']) {
    expect(cachedPaths, 'missing cached PWA resource ' + path).toContain(path);
  }
  await context.setOffline(true);
  const offlineIndex = await page.evaluate(async () => {
    const cache = await caches.open('today-weather-shell-v2');
    const response = await cache.match('./index.html');
    return response ? { status: response.status, html: await response.text() } : null;
  });
  expect(offlineIndex?.status).toBe(200);
  expect(offlineIndex?.html).toContain('class="site-header"');
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('#searchInput')).toBeVisible();
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mainNav')).toHaveClass(/active/);
});

test('manual GPS selection refreshes weather for the newly selected location', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 36.716667, longitude: 4.05 });
  await page.addInitScript(() => {
    localStorage.setItem('algeria_weather_location_v2', JSON.stringify({
      data: { lat: 36.752887, lon: 3.042048, name: 'الجزائر العاصمة', state: 'الجزائر العاصمة', country: 'الجزائر', displayName: 'الجزائر العاصمة / الجزائر' },
      timestamp: Date.now()
    }));
  });
  await page.route('https://api.openweathermap.org/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/geo/1.0/reverse')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ name: 'تيزي وزو', state: 'تيزي وزو', country: 'DZ' }]) });
    }
    if (url.pathname.endsWith('/forecast')) {
      const now = Math.floor(Date.now() / 1000);
      const list = Array.from({ length: 8 }, (_, i) => ({
        dt: now + i * 10800,
        main: { temp: 22 + i, feels_like: 22 + i, humidity: 55, pressure: 1012 },
        weather: [{ id: 800, description: 'سماء صافية', icon: '01d' }],
        wind: { speed: 2, deg: 90 }, clouds: { all: 0 }, rain: { '3h': 0 }
      }));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ list }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      main: { temp: 24, feels_like: 24, humidity: 55, pressure: 1012 },
      weather: [{ id: 800, description: 'سماء صافية', icon: '01d' }],
      wind: { speed: 2, deg: 90 }, visibility: 10000, clouds: { all: 0 }, name: 'Algeria'
    }) });
  });
  await page.route('https://tile.openweathermap.org/**', route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#currentCity')).toContainText('الجزائر العاصمة');
  await page.locator('#locationBtn').click();
  await expect(page.locator('#currentCity')).toContainText('تيزي وزو', { timeout: 10000 });
});

test('performance safeguards defer third-party scripts and omit unused heavy libraries', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const checks = await page.evaluate(() => ({
    blockingHeadScripts: [...document.head.querySelectorAll('script[src]')]
      .filter(script => !script.async && !script.defer)
      .map(script => script.src),
    unusedLibraries: [...performance.getEntriesByType('resource')]
      .map(entry => entry.name)
      .filter(url => /three\\.min\\.js|chartjs-plugin-datalabels/i.test(url))
  }));
  expect(checks.blockingHeadScripts).toEqual([]);
  expect(checks.unusedLibraries).toEqual([]);
});
