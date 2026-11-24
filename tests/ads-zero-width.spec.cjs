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
      // Keep the wrapper measurable while forcing the actual AdSense slot to zero width.
      firstAd?.style.setProperty('width', '0px');
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('ins.adsbygoogle')).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBe(0);

  await page.locator('script[src*="adsbygoogle.js"]').evaluate(script => script.dispatchEvent(new Event('load')));
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBe(0);
  await page.locator('ins.adsbygoogle').first().evaluate(ad => {
    ad.style.removeProperty('width');
  });
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBeGreaterThan(0);
});


test('AdSense-generated auto-placement wrappers are not removed during mutation handling', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'google-auto-placed';
    wrapper.innerHTML = '<ins class="adsbygoogle" data-ad-client="ca-pub-5656416032906373" data-ad-slot="9999999999"></ins>';
    document.body.appendChild(wrapper);
  });

  await expect(page.locator('body > .google-auto-placed')).toHaveCount(1);
  await expect(page.locator('body > .google-auto-placed ins.adsbygoogle')).toHaveCount(1);
});

test('AdSense push waits for an earlier Google-managed slot to finish before manual slots', async ({ page }) => {
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
      const wrapper = document.createElement('div');
      wrapper.className = 'google-auto-placed';
      wrapper.innerHTML = '<ins class="adsbygoogle" data-ad-client="ca-pub-5656416032906373"></ins>';
      document.body.prepend(wrapper);
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body > .google-auto-placed ins.adsbygoogle')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBe(0);

  await page.locator('body > .google-auto-placed ins.adsbygoogle')
    .evaluate(ad => ad.setAttribute('data-adsbygoogle-status', 'done'));
  await page.locator('script[src*="adsbygoogle.js"]').evaluate(script => script.dispatchEvent(new Event('load')));
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBeGreaterThan(0);
});


test('AdSense never queues a push before the async provider script has loaded', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__adsPushCount = 0;
    window.adsbygoogle = { push() { window.__adsPushCount += 1; } };
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.ad-container ins.adsbygoogle').first()).toBeVisible();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__adsPushCount)).toBe(0);

  await page.locator('script[src*="adsbygoogle.js"]').evaluate(script => script.dispatchEvent(new Event('load')));
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBeGreaterThan(0);
});


test('AdSense waits for an approved container to recover from zero width', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__adsPushCount = 0;
    window.adsbygoogle = { push() { window.__adsPushCount += 1; } };
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const container = page.locator('.ad-container').first();
  const ad = container.locator('ins.adsbygoogle');
  await expect(ad).toBeVisible();

  await container.evaluate(node => {
    node.style.setProperty('width', '0px', 'important');
    node.style.setProperty('max-width', '0px', 'important');
  });
  await page.locator('script[src*="adsbygoogle.js"]')
    .evaluate(script => script.dispatchEvent(new Event('load')));
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBe(0);

  await container.evaluate(node => {
    node.style.removeProperty('width');
    node.style.removeProperty('max-width');
  });
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBeGreaterThan(0);
});
