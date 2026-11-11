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
assert.deepEqual(urls, ['https://imadtbn.github.io/today-weather/'], 'SPA sitemap should list only its canonical page');
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
const jsFiles = [
  'assets/js/core.js', 'assets/js/geo-service.js', 'assets/js/weather-service.js',
  'assets/js/ui.js', 'assets/js/map-service.js', 'assets/js/search-news.js',
  'assets/js/effects.js', 'assets/js/app.js', 'assets/js/adsData.js', 'sw.js'
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
const unreferenced = activeJs.filter(file => !scriptRefs.includes('assets/js/' + file));
assert.deepEqual(unreferenced, [], 'Unreferenced JavaScript files remain: ' + unreferenced.join(', '));

console.log('Site validation passed: HTML, SEO, JSON-LD, sitemap, PWA cache, CSS and JavaScript.');
