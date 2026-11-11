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
      body: document.body.scrollWidth
    }));
    expect(metrics.document, 'document overflow at viewport ' + width).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.body, 'body overflow at viewport ' + width).toBeLessThanOrEqual(metrics.viewport + 1);
  }
});

test('service worker installs and serves the app shell while offline', async ({ page, context }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
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
});
