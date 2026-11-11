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

test('service worker installs and serves the app shell while offline', async ({ page, context }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()), null, { timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // A second online navigation ensures this document is controlled by the active worker.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10000 });
  await page.waitForFunction(async () => {
    for (const key of await caches.keys()) {
      if (!key.startsWith('today-weather-shell-')) continue;
      if (await (await caches.open(key)).match('./index.html')) return true;
    }
    return false;
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.locator('#weatherMap')).toBeAttached();
  const offlineBackground = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(offlineBackground).toBe('rgb(10, 14, 26)');
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mainNav')).toHaveClass(/active/);
});
