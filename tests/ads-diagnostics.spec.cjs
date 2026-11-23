const { test, expect } = require('@playwright/test');

test('AdSense loader diagnostics recover a load completed before the listener attaches', async ({ page }) => {
  await page.addInitScript(() => {
    const original = performance.getEntriesByName.bind(performance);
    performance.getEntriesByName = (name, type) => {
      if (String(name).includes('adsbygoogle.js')) {
        return [{ name, entryType: 'resource', startTime: 1, responseEnd: 24, responseStatus: 200, encodedBodySize: 128 }];
      }
      return original(name, type);
    };
    window.__adsLoaderEvents = [];
    window.addEventListener('adsense:loader', event => window.__adsLoaderEvents.push(event.detail));
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.__adsLoaderEvents.some(item => item.status === 'loaded'))).toBe(true);
  const recovered = await page.evaluate(() => window.__adsLoaderEvents.find(item => item.status === 'loaded'));
  expect(recovered.detail).toContain('before diagnostics attached');
});

test('AdSense audit records mobile and desktop requests and per-slot states without changing placements', async ({ page }) => {
  const network = [];
  const consoleErrors = [];
  page.on('request', request => {
    if (/adsbygoogle\.js|googleads\.g\.doubleclick\.net|pagead2\.googlesyndication\.com/i.test(request.url())) {
      network.push({ type: 'request', url: request.url(), method: request.method() });
    }
  });
  page.on('response', response => {
    if (/adsbygoogle\.js|googleads\.g\.doubleclick\.net|pagead2\.googlesyndication\.com/i.test(response.url())) {
      network.push({ type: 'response', url: response.url(), status: response.status() });
    }
  });
  page.on('requestfailed', request => {
    if (/adsbygoogle\.js|googleads\.g\.doubleclick\.net|pagead2\.googlesyndication\.com/i.test(request.url())) {
      network.push({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText || 'unknown' });
    }
  });
  page.on('console', message => {
    if (message.type() === 'error' && /adsense|adsbygoogle|googleads/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  await page.addInitScript(() => {
    window.__adsAuditEvents = [];
    window.addEventListener('adsense:loader', event => window.__adsAuditEvents.push({ kind: 'loader', ...event.detail }));
    window.addEventListener('adsense:status', event => window.__adsAuditEvents.push({ kind: 'slot', ...event.detail }));
  });

  const cases = [
    { name: 'mobile-home', width: 390, height: 844, path: '/' },
    { name: 'desktop-city', width: 1440, height: 1000, path: '/weather/algeria/algiers/' }
  ];
  const reports = [];

  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await page.goto(item.path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('ins.adsbygoogle')).toHaveCount(item.path === '/' ? 6 : 2);
    await page.waitForTimeout(6000);

    const report = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      slots: [...document.querySelectorAll('ins.adsbygoogle')].map(ad => ({
        slot: ad.getAttribute('data-ad-slot'),
        placement: ad.closest('[data-ad-placement]')?.getAttribute('data-ad-placement') || 'unknown',
        status: ad.getAttribute('data-ad-status') || ad.dataset.adsDiagnosticStatus || 'pending',
        initialized: ad.getAttribute('data-adsbygoogle-status') || ad.dataset.adsInit || 'not-marked'
      })),
      events: window.__adsAuditEvents || []
    }));
    expect(report.documentWidth).toBeLessThanOrEqual(report.viewport.width + 1);
    expect(report.slots.every(slot => slot.slot && slot.placement !== 'unknown')).toBe(true);
    reports.push({ name: item.name, ...report });
  }

  console.info('[AdSense browser audit]', JSON.stringify({ reports, network, consoleErrors }));
  expect(reports[0].slots.map(slot => slot.slot)).toEqual([
    '7867079394', '3143411927', '8546947691', '1760836049', '6152718642', '6528123169'
  ]);
  expect(reports[1].slots.map(slot => slot.slot)).toEqual(['7867079394', '3143411927']);
});
