const { test, expect } = require('@playwright/test');

test('AdSense waits until the first approved slot has measurable width', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__adsPushCount = 0;
    window.adsbygoogle = {
      push() {
        window.__adsPushCount += 1;
        return window.__adsPushCount;
      }
    };
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const firstAd = document.querySelector('ins.adsbygoogle');
      firstAd?.closest('.ad-container')?.style.setProperty('display', 'none');
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('ins.adsbygoogle')).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBe(0);

  await page.locator('ins.adsbygoogle').first().evaluate(ad => {
    ad.closest('.ad-container').style.removeProperty('display');
  });
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBeGreaterThan(0);
});
