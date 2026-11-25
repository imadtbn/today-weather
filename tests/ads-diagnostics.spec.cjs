const { test, expect } = require('@playwright/test');

test('AdSense loader readiness requires an explicit successful onload marker', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__adsLoaderEvents = [];
    window.addEventListener('adsense:loader', event => window.__adsLoaderEvents.push(event.detail));
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') {
        const loader = document.querySelector('script[src*="adsbygoogle.js"]');
        if (loader) loader.dataset.adsenseLoaded = 'true';
      }
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() =>
    window.__adsLoaderEvents.some(item => item.status === 'loaded')
  )).toBe(true);
  const loaded = await page.evaluate(() =>
    window.__adsLoaderEvents.find(item => item.status === 'loaded')
  );
  expect(loaded.detail).toContain('onload marker');
});


test('AdSense audit records mobile and desktop slots without changing placements', async ({ page }) => {
  // Ten page/viewport combinations each retain the six-second provider observation window.
  test.setTimeout(90000);
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
    window.addEventListener('adsense:pre-push', event => window.__adsAuditEvents.push({ kind: 'pre-push', ...event.detail }));
    window.addEventListener('adsense:placement-warning', event => window.__adsAuditEvents.push({ kind: 'placement-warning', ...event.detail }));
    window.addEventListener('adsense:auto-placement', event => window.__adsAuditEvents.push({ kind: 'auto-placement', ...event.detail }));
    window.addEventListener('adsense:push', event => window.__adsAuditEvents.push({ kind: 'push', ...event.detail }));
    window.addEventListener('adsense:tag-error', event => window.__adsAuditEvents.push({ kind: 'tag-error', ...event.detail }));
    window.addEventListener('adsense:auto-placement-error', event => window.__adsAuditEvents.push({ kind: 'auto-placement-error', ...event.detail }));
  });

  const routes = [
    { name: 'home', path: '/', slots: ['7867079394', '6528123169', '8546947691', '1760836049', '6152718642', '3143411927'] },
    { name: 'wilaya', path: '/weather/algeria/batna/', slots: ['7867079394', '3143411927'] },
    { name: 'commune', path: '/weather/algeria/communes/batna/tilatou/', slots: ['7867079394', '3143411927'] },
    { name: 'arab-capital', path: '/weather/arab/doha/', slots: ['7867079394', '3143411927'] },
    { name: 'world-city', path: '/weather/world/dakar/', slots: ['7867079394', '3143411927'] }
  ];
  const cases = routes.flatMap(route => [
    { ...route, name: 'mobile-' + route.name, width: 390, height: 844 },
    { ...route, name: 'desktop-' + route.name, width: 1440, height: 1000 }
  ]);
  const reports = [];

  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await page.goto(item.path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.ad-container ins.adsbygoogle')).toHaveCount(item.slots.length);
    await page.waitForTimeout(6000);

    const report = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      slots: [...document.querySelectorAll('ins.adsbygoogle')].map(ad => {
        const slot = ad.getAttribute('data-ad-slot') || '';
        return {
          slot,
          validSlot: /^\d{8,12}$/.test(slot),
          inApprovedContainer: Boolean(ad.closest('.ad-container')),
          googleManaged: Boolean(ad.closest('.google-auto-placed')) ||
            (ad.hasAttribute('data-adsbygoogle-status') && !slot && !ad.closest('.ad-container')),
          inHeader: Boolean(ad.closest('.site-header')),
          status: ad.getAttribute('data-ad-status') || ad.dataset.adsDiagnosticStatus || 'pending',
          geometry: { slotWidth: ad.getBoundingClientRect().width, parentWidth: ad.parentElement?.getBoundingClientRect().width || 0, containerWidth: ad.closest('.ad-container')?.getBoundingClientRect().width || 0, visible: Boolean(ad.getClientRects().length && getComputedStyle(ad).display !== 'none') },
          initialized: ad.getAttribute('data-adsbygoogle-status') || ad.dataset.adsInit || 'not-marked'
        };
      }),
      events: window.__adsAuditEvents || [],
      pushEvents: (window.__adsAuditEvents || []).filter(event => event.kind === 'push'),
      tagErrors: (window.__adsAuditEvents || []).filter(event => event.kind === 'tag-error' || event.kind === 'auto-placement-error')
    }));

    const expected = item.slots;
    const siteSlots = report.slots.filter(slot => slot.inApprovedContainer).map(slot => slot.slot);
    const invalidSlots = report.slots.filter(slot =>
      (!slot.validSlot && !slot.googleManaged) || (!slot.inApprovedContainer && !slot.googleManaged) || slot.inHeader
    );

    expect(
      consoleErrors.filter(message => /No slot size for availableWidth=0/i.test(message)),
      'AdSense must not initialize a slot before its width is measurable'
    ).toEqual([]);
    console.info('[AdSense browser audit]', JSON.stringify({ name: item.name, slots: report.slots, network, consoleErrors }));
    expect(report.documentWidth).toBeLessThanOrEqual(report.viewport.width + 1);
    expect(report.tagErrors, 'AdSense TagError diagnostics must be empty during the browser audit').toEqual([]);
    expect(invalidSlots, 'Every AdSense unit must have a valid data-ad-slot and an approved or Google-managed placement').toEqual([]);
    expect(siteSlots).toEqual(expected);
    reports.push({ name: item.name, ...report });
  }

  console.info('[AdSense browser audit summary]', JSON.stringify({ reports, network, consoleErrors }));
});


test('Google-managed Auto ads in the header remain hidden and are diagnosed', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__headerAdWarnings = [];
    window.addEventListener('adsense:placement-warning', event => window.__headerAdWarnings.push(event.detail));
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'google-auto-placed';
    wrapper.innerHTML = '<ins class="adsbygoogle" data-adsbygoogle-status="done"></ins>';
    document.querySelector('.site-header').appendChild(wrapper);
  });

  const autoAd = page.locator('.site-header .google-auto-placed ins.adsbygoogle');
  await expect(autoAd).toHaveCount(1);
  await expect.poll(() => autoAd.evaluate(node => getComputedStyle(node.parentElement).display)).toBe('none');
  await expect.poll(() => page.evaluate(() => window.__headerAdWarnings.length)).toBe(1);
  const warning = await page.evaluate(() => window.__headerAdWarnings[0]);
  expect(warning.placement).toBe('site-header');
  expect(warning.reason).toContain('exclude header placements');
});


test('Zero-width Google-managed Auto ads placements are surfaced in diagnostics', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__autoPlacementDiagnostics = [];
    window.addEventListener('adsense:auto-placement', event => window.__autoPlacementDiagnostics.push(event.detail));
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'google-auto-placed';
    wrapper.style.width = '0px';
    wrapper.innerHTML = '<ins class="adsbygoogle" data-adsbygoogle-status="done"></ins>';
    document.body.appendChild(wrapper);
  });

  await expect.poll(() => page.evaluate(() => window.__autoPlacementDiagnostics.length)).toBe(1);
  const diagnostic = await page.evaluate(() => window.__autoPlacementDiagnostics[0]);
  expect(diagnostic.placement).toBe('google-auto-placement');
  expect(diagnostic.zeroWidth).toBe(true);
  expect(diagnostic.measurements.containerWidth).toBe(0);
});


test('Unified ad placements stay visible until AdSense confirms a final unfilled result', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());

  const pages = [
    '/',
    '/weather/algeria/algiers/',
    '/weather/arab/doha/',
    '/weather/world/dakar/',
    '/weather/algeria/communes/adrar/adrar/'
  ];

  const viewports = [
    { width: 390, height: 844, label: 'mobile' },
    { width: 1440, height: 900, label: 'desktop' }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const path of pages) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const top = page.locator('.ad-container[data-ad-placement="top"] ins.adsbygoogle[data-ad-slot="7867079394"]');
    const footer = page.locator('.ad-container[data-ad-placement="footer"] ins.adsbygoogle[data-ad-slot="3143411927"]');
    await expect(top, 'Top ad slot must exist on ' + path).toHaveCount(1);
    await expect(footer, 'Footer ad slot must exist on ' + path).toHaveCount(1);

    const initial = await page.evaluate(() => ({
      top: getComputedStyle(document.querySelector('.ad-container[data-ad-placement="top"]')).display,
      footer: getComputedStyle(document.querySelector('.ad-container[data-ad-placement="footer"]')).display,
      topWidth: document.querySelector('.ad-container[data-ad-placement="top"] ins').getBoundingClientRect().width,
      footerWidth: document.querySelector('.ad-container[data-ad-placement="footer"] ins').getBoundingClientRect().width
    }));
    expect(initial.top, 'Top container must remain visible while its request is pending').not.toBe('none');
    expect(initial.footer, 'Footer container must remain visible while its request is pending').not.toBe('none');
    expect(initial.topWidth).toBeGreaterThan(0);
    expect(initial.footerWidth).toBeGreaterThan(0);
    expect(Math.abs(initial.topWidth - initial.footerWidth)).toBeLessThan(2);

    await top.evaluate(node => node.setAttribute('data-ad-status', 'unfilled'));
    await expect(page.locator('.ad-container[data-ad-placement="top"]')).not.toHaveCSS('display', 'none');

    await top.evaluate(node => node.setAttribute('data-adsbygoogle-status', 'done'));
    await expect(page.locator('.ad-container[data-ad-placement="top"]')).toHaveCSS('display', 'none');

    await footer.evaluate(node => node.setAttribute('data-ad-status', 'filled'));
    await expect(page.locator('.ad-container[data-ad-placement="footer"]')).not.toHaveCSS('display', 'none');
    }
  }
});


test('AdSense TagError diagnostics preserve the original message, stack, push count and slot states', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.abort());
  await page.addInitScript(() => {
    window.__tagErrorReports = [];
    window.addEventListener('adsense:tag-error', event => window.__tagErrorReports.push(event.detail));
  });

  await page.goto('/weather/algeria/communes/batna/tilatou/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const error = new Error('TagError: simulated provider failure');
    error.stack = 'TagError: simulated provider failure\\n    at simulatedAdCall (adsbygoogle.js:155:253)';
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'TagError: simulated provider failure',
      filename: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
      lineno: 155,
      colno: 253,
      error
    }));
  });

  await expect.poll(() => page.evaluate(() => window.__tagErrorReports.length)).toBe(1);
  const report = await page.evaluate(() => window.__tagErrorReports[0]);
  expect(report.message).toContain('TagError: simulated provider failure');
  expect(report.stack).toContain('simulatedAdCall');
  expect(report.filename).toContain('adsbygoogle.js');
  expect(report.line).toBe(155);
  expect(report.column).toBe(253);
  expect(report.pushCount).toBe(0);
  expect(report.page).toContain('/weather/algeria/communes/batna/tilatou/');
  expect(report.slots).toHaveLength(2);
  expect(report.slots.every(slot => slot.owner === 'manual')).toBe(true);
  expect(report.slots.every(slot => slot.measurements.containerContentWidth >= 0)).toBe(true);
});


test('Manual AdSense units are pushed once each and are not reinitialized by repeated observers', async ({ page }) => {
  await page.route('**/adsbygoogle.js**', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.__adsPushes = []; window.adsbygoogle = { push: function (item) { window.__adsPushes.push(item); return window.__adsPushes.length; } };'
  }));

  await page.addInitScript(() => {
    window.__adsPushEvents = [];
    window.addEventListener('adsense:push', event => window.__adsPushEvents.push(event.detail));
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/weather/algeria/communes/batna/tilatou/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => (window.__adsPushes || []).length)).toBe(2);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    document.querySelectorAll('.ad-container').forEach(container => {
      container.classList.toggle('ads-test-observed');
    });
  });
  await page.waitForTimeout(250);

  const result = await page.evaluate(() => ({
    pushes: window.__adsPushes.length,
    events: window.__adsPushEvents,
    slots: [...document.querySelectorAll('.ad-container ins.adsbygoogle')].map(ad => ad.dataset.adsInit)
  }));
  expect(result.pushes).toBe(2);
  expect(result.events).toHaveLength(2);
  expect(new Set(result.events.map(event => event.slot))).toEqual(new Set(['7867079394', '3143411927']));
  expect(result.slots).toEqual(['queued', 'queued']);
});
