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


test('AdSense waits while an approved slot is inside a display-none ancestor', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__adsPushCount = 0;
    window.adsbygoogle = { push() { window.__adsPushCount += 1; } };
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const container = page.locator('.ad-container').first();
  await container.evaluate(node => { node.style.setProperty('display', 'none', 'important'); });
  await page.locator('script[src*="adsbygoogle.js"]')
    .evaluate(script => script.dispatchEvent(new Event('load')));
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBe(0);

  await container.evaluate(node => { node.style.removeProperty('display'); });
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBeGreaterThan(0);
});

test('AdSense pushes only after measurable width is stable across animation frames', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__adsPushCount = 0;
    window.__adsStableFrames = [];
    window.addEventListener('adsense:pre-push', event => {
      if (event.detail && event.detail.available) {
        window.__adsStableFrames.push(event.detail.stableFrames);
      }
    });
    window.adsbygoogle = { push() { window.__adsPushCount += 1; } };
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('script[src*="adsbygoogle.js"]')
    .evaluate(script => script.dispatchEvent(new Event('load')));
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBeGreaterThan(0);
  const stableFrames = await page.evaluate(() => window.__adsStableFrames);
  expect(stableFrames.length).toBeGreaterThan(0);
  expect(stableFrames.every(frames => frames >= 2)).toBe(true);
});

test('AdSense does not initialize the same slot more than once after resize and mutations', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__adsPushCount = 0;
    window.adsbygoogle = { push() { window.__adsPushCount += 1; } };
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('script[src*="adsbygoogle.js"]')
    .evaluate(script => script.dispatchEvent(new Event('load')));
  const expectedSlots = await page.locator('.ad-container ins.adsbygoogle').count();
  await expect.poll(() => page.evaluate(() => window.__adsPushCount)).toBe(expectedSlots);
  const initialCount = await page.evaluate(() => window.__adsPushCount);

  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    document.querySelectorAll('.ad-container').forEach(node => {
      node.classList.toggle('ads-test-layout');
      node.classList.toggle('ads-test-layout');
    });
  });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__adsPushCount)).toBe(initialCount);
});

test('AdSense reports zero-width TagErrors separately for Google-managed Auto Ads', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const diagnostic = await page.evaluate(() => new Promise(resolve => {
    const wrapper = document.createElement('div');
    wrapper.className = 'google-auto-placed';
    wrapper.innerHTML = '<ins class="adsbygoogle" data-ad-client="ca-pub-5656416032906373" data-ad-slot="auto-test" style="display:block;width:0px"></ins>';
    document.body.appendChild(wrapper);

    window.addEventListener('adsense:auto-placement-error', event => resolve(event.detail), { once: true });
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'adsbygoogle.push() error: No slot size for availableWidth=0'
    }));
  }));

  expect(diagnostic.message).toContain('No slot size');
  expect(diagnostic.source).toBe('window.error');
  expect(diagnostic.likelyAutoPlacement).toBe(true);
  expect(diagnostic.googleManagedSlots).toHaveLength(1);
});
