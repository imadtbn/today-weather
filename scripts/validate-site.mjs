import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const html = read('index.html');
const css = read('assets/css/style-main.css');
const sitemap = read('sitemap.xml');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const weatherTips = JSON.parse(read('data/weather-tips.json'));
assert.ok(Array.isArray(weatherTips.rules) && weatherTips.rules.length >= 10, 'Dynamic weather tips rules are missing');
assert.ok(weatherTips.rules.every(rule => rule.id && rule.category && rule.conditions && rule.message), 'Weather tips rules must be complete');

const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
  .map(m => m[1])
  .filter(v => !/^(?:https?:|#|data:|mailto:|tel:|javascript:)/i.test(v));
for (const ref of refs) {
  const path = ref.split(/[?#]/)[0].replace(/^\.\//, '');
  if (path) assert.ok(existsSync(resolve(root, path)), 'Missing HTML resource: ' + ref);
}

const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
assert.equal(jsonLd.length, 1, 'Expected one JSON-LD block');
for (const block of jsonLd) JSON.parse(block[1]);
assert.equal((html.match(/<h1\b/gi) || []).length, 1, 'Expected one H1');
assert.equal((html.match(/<link rel="canonical"/gi) || []).length, 1, 'Expected one canonical URL');
assert.ok(/<meta name="description"\s+content="[^"]{60,}"/i.test(html), 'Meta description missing or short');
assert.ok(html.includes('property="og:image" content="https://imadtbn.github.io/today-weather/assets/images/icon1.webp"'));
assert.ok(!html.includes('"@type": "FAQPage"'), 'FAQ schema must match visible FAQ content');

const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const cityGroups = [
  { key: 'algeria', file: 'data/cities.json', count: 69 },
  { key: 'arab', file: 'data/arab-capitals.json', count: 22 },
  { key: 'world', file: 'data/world-capitals.json', count: 195 }
];
const expectedCityCount = cityGroups.reduce((sum, group) => sum + JSON.parse(read(group.file)).length, 0);
assert.equal(expectedCityCount, 286, 'Expected 286 source city records');
assert.equal(urls.length, expectedCityCount + 5, 'Sitemap must include home, directory index, three category indexes and every city page');
assert.equal(new Set(urls).size, urls.length, 'Sitemap contains duplicate URLs');
assert.ok(urls.includes('https://imadtbn.github.io/today-weather/weather/'));
for (const group of cityGroups) {
  const cities = JSON.parse(read(group.file));
  assert.equal(cities.length, group.count, 'Unexpected city count for ' + group.key);
  assert.ok(urls.includes('https://imadtbn.github.io/today-weather/weather/' + group.key + '/'));
  for (const city of cities) {
    const pagePath = 'weather/' + group.key + '/' + city.slug + '/index.html';
    assert.ok(existsSync(resolve(root, pagePath)), 'Missing generated city page: ' + pagePath);
    const page = read(pagePath);
    assert.ok(page.includes('<h1 class="city-title">طقس '), 'City H1 missing: ' + pagePath);
    assert.ok(page.includes('rel="canonical" href="https://imadtbn.github.io/today-weather/weather/' + group.key + '/' + city.slug + '/"'), 'City canonical missing: ' + pagePath);
    assert.ok(page.includes('id="cityTemp"') && page.includes('id="cityForecast"'), 'Live weather fields missing: ' + pagePath);
    const pageJsonLd = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.equal(pageJsonLd.length, 1, 'Expected one JSON-LD block in ' + pagePath);
    const pageSchema = JSON.parse(pageJsonLd[0][1]);
    assert.ok(pageSchema['@graph']?.some(item => item['@type'] === 'Place' && item.geo), 'Place/GeoCoordinates schema missing: ' + pagePath);
    assert.ok(pageSchema['@graph']?.some(item => item['@type'] === 'BreadcrumbList'), 'Breadcrumb schema missing: ' + pagePath);
    assert.ok(page.includes('assets/css/city-pages.css') && page.includes('assets/js/city-page.js'), 'City page assets missing: ' + pagePath);
    assert.ok(urls.includes('https://imadtbn.github.io/today-weather/weather/' + group.key + '/' + city.slug + '/'), 'City URL missing from sitemap: ' + city.slug);
  }
}
assert.ok(!urls.some(url => url.includes('#')));
assert.ok(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap));

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.dir, 'rtl');
for (const icon of manifest.icons || []) {
  assert.ok(existsSync(resolve(root, icon.src)), 'Missing PWA icon: ' + icon.src);
}

const shell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
assert.ok(shell, 'Service worker app shell missing');
for (const match of shell[1].matchAll(/["'](\.[^"']+)["']/g)) {
  const path = match[1].replace(/^\.\//, '');
  if (path) assert.ok(existsSync(resolve(root, path)), 'Missing cached asset: ' + path);
}
for (const host of ['cdnjs.cloudflare.com', 'unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
  assert.ok(sw.includes(host), 'Static external cache allowlist missing: ' + host);
}

assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, 'Unbalanced CSS braces');
const cityCss = read('assets/css/city-pages.css');
assert.equal((cityCss.match(/{/g) || []).length, (cityCss.match(/}/g) || []).length, 'Unbalanced city page CSS braces');
const jsFiles = [
  'assets/js/core.js', 'assets/js/geo-service.js', 'assets/js/weather-service.js', 'assets/js/weather-tips-engine.js',
  'assets/js/ui.js', 'assets/js/map-service.js', 'assets/js/search-news.js',
  'assets/js/effects.js', 'assets/js/app.js', 'assets/js/adsData.js', 'assets/js/city-page.js', 'sw.js'
];
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, file + ': ' + (result.stderr || result.stdout));
}

const scriptRefs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
for (const stale of ['assets/js/main.js', 'assets/js/main22script.js', 'assets/js/mainscript.js', 'assets/js/mainscript1.js']) {
  assert.ok(!scriptRefs.includes(stale), 'Legacy script still referenced: ' + stale);
}
const activeJs = readdirSync(resolve(root, 'assets/js')).filter(file => file.endsWith('.js'));
const unreferenced = activeJs.filter(file => !scriptRefs.includes('assets/js/' + file) && file !== 'city-page.js');
assert.deepEqual(unreferenced, [], 'Unreferenced JavaScript files remain: ' + unreferenced.join(', '));


assert.ok(html.includes('href="tel:+213697743721"'), 'Clickable contact phone missing');
assert.ok(html.includes('href="mailto:tabaniimadeddine@gmail.com"'), 'Clickable contact email missing');
const organization = JSON.parse(jsonLd[0][1])['@graph'].find(item => item['@type'] === 'Organization');
assert.ok(organization?.telephone === '+213697743721', 'Organization telephone schema missing');
assert.ok(organization?.email === 'tabaniimadeddine@gmail.com', 'Organization email schema missing');
assert.ok(html.includes('weather forecast') && html.includes('météo Algérie'), 'Multilingual weather search terms missing');
assert.ok(html.includes('id="weather-guide-title"'), 'Indexable weather guide content missing');
console.log('Site validation passed: HTML, SEO, JSON-LD, sitemap, PWA cache, CSS and JavaScript.');
