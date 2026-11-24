import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { auditCommuneSource, buildCommuneWeatherRecord } from './communes-data.mjs';

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

const adsTxt = read('ads.txt').trim();
assert.equal(adsTxt, 'google.com, pub-5656416032906373, DIRECT, f08c47fec0942fa0', 'ads.txt publisher declaration is missing or malformed');
const adsScript = read('assets/js/adsData.js');
for (const marker of ['adsense:status', 'adsense:loader', 'adsense:pre-push', 'adsense:blocked', 'adsense:placement-warning', 'adsense:auto-placement', 'filled', 'unfilled', 'requested', 'init-error', 'MutationObserver', 'attributeFilter', 'getSlotMeasurements', 'adsenseLoaded', 'reportPreviouslyLoadedResource']) {
  assert.ok(adsScript.includes(marker), 'AdSense diagnostics marker missing: ' + marker);
}
assert.ok(adsScript.includes("has('ads-debug')"), 'AdSense debug query switch missing');
assert.ok(html.includes('data-ad-client="ca-pub-5656416032906373"'), 'Homepage AdSense publisher ID missing');
assert.ok(html.includes('onload="this.dataset.adsenseLoaded=\'true\'"'), 'AdSense loader must persist successful load state');
const homepageAdSlots = [...html.matchAll(/data-ad-slot="(\d+)"/g)].map(match => match[1]);
assert.equal(new Set(homepageAdSlots).size, 6, 'Expected six distinct homepage AdSense ad slots');
assert.equal(homepageAdSlots.length, 6, 'Expected each homepage ad slot exactly once');

const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
  .map(m => m[1])
  .filter(v => !/^(?:https?:|#|data:|mailto:|tel:|javascript:)/i.test(v));
for (const ref of refs) {
  const path = ref.split(/[?#]/)[0]
    .replace(/^\.\//, '')
    .replace(/^\/today-weather\/?/, '');
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

function assertSharedPageShell(page, pagePath) {
  for (const marker of [
    'name="google-site-verification" content="f5Xi4oFx0v5dN6iPZd9qCw-7vnc3vIbAeYF9jr4vwVM"',
    'name="msvalidate.01" content="9BCA38377A234DCCEB9991EAD1A2F6C2"',
    'googletagmanager.com/gtm.js?id=GTM-PTCXG7CG',
    'window.dataLayer = window.dataLayer || []',
    'adsbygoogle.js?client=ca-pub-5656416032906373',
    'class="site-header"', 'id="siteHeader"', 'id="mainNav"',
    'id="mobileMenuBtn"', 'id="searchInput"', 'id="citySuggestions"',
    'id="locationBtn"', 'class="site-footer"', 'class="footer-grid"',
    'class="footer-title"', 'class="footer-contact-item"',
    'href="tel:+213697743721"', 'href="mailto:tabaniimadeddine@gmail.com"',
    'OpenWeatherMap', 'Leaflet', 'OpenStreetMap contributors',
    'assets/css/style-main.css', 'assets/js/adsData.js'
  ]) assert.ok(page.includes(marker), 'Homepage shell marker missing (' + marker + '): ' + pagePath);

  assert.ok(page.includes('onload="this.dataset.adsenseLoaded=\'true\'"'), 'AdSense loader onload handler must be valid on ' + pagePath);
  const pageLd = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(pageLd.length, 1, 'Expected exactly one JSON-LD block: ' + pagePath);
  const pageGraph = JSON.parse(pageLd[0][1])['@graph'];
  assert.ok(pageGraph?.some(item => item['@type'] === 'WebSite'), 'WebSite schema missing: ' + pagePath);
  assert.ok(pageGraph?.some(item => item['@type'] === 'Organization'), 'Organization schema missing: ' + pagePath);
  assert.ok(pageGraph?.some(item => ['WebPage', 'CollectionPage'].includes(item['@type'])), 'Page schema missing: ' + pagePath);
  assert.ok(pageGraph?.some(item => item['@type'] === 'BreadcrumbList'), 'Breadcrumb schema missing: ' + pagePath);
  const pageNode = pageGraph.find(item => ['WebPage', 'CollectionPage'].includes(item['@type']));
  assert.equal(pageNode.isPartOf?.['@id'], 'https://imadtbn.github.io/today-weather/#website', 'Page-to-website relation missing: ' + pagePath);
  assert.equal(pageNode.publisher?.['@id'], 'https://imadtbn.github.io/today-weather/#organization', 'Page publisher relation missing: ' + pagePath);
  assert.equal((page.match(/class="site-header"/g) || []).length, 1, 'Expected one homepage header: ' + pagePath);
  assert.equal((page.match(/class="site-footer"/g) || []).length, 1, 'Expected one homepage footer: ' + pagePath);
  assert.ok(page.includes('href="/today-weather/sitemap.html"'), 'Footer sitemap link missing: ' + pagePath);
  assert.ok(page.includes('href="/today-weather/weather/algeria/communes/"'), 'Footer commune directory link missing: ' + pagePath);
  assert.equal((page.match(/class="ad-container"/g) || []).length, 2, 'Expected exactly two ad containers: ' + pagePath);
  assert.equal((page.match(/data-ad-slot="7867079394"/g) || []).length, 1, 'Top ad slot must appear exactly once: ' + pagePath);
  assert.equal((page.match(/data-ad-slot="3143411927"/g) || []).length, 1, 'Footer ad slot must appear exactly once: ' + pagePath);
  assert.equal((page.match(/adsbygoogle.js\?client=ca-pub-5656416032906373/g) || []).length, 1, 'AdSense loader must appear once: ' + pagePath);
  assert.equal((page.match(/assets\/js\/adsData.js/g) || []).length, 1, 'Ad placement guard must appear once: ' + pagePath);
  const heroStart = Math.max(page.indexOf('class="directory-hero"'), page.indexOf('class="city-hero"'), page.indexOf('class="sitemap-hero"'));
  assert.ok(heroStart >= 0, 'Page hero missing: ' + pagePath);
  const heroEndTag = page.indexOf('class="city-hero"') >= 0 ? '</section>' : '</header>';
  const heroEnd = page.indexOf(heroEndTag, heroStart);
  const topAd = page.indexOf('data-ad-slot="7867079394"');
  const footerAd = page.indexOf('data-ad-slot="3143411927"');
  assert.ok(heroEnd > heroStart && topAd > heroEnd && topAd < page.indexOf('</main>'), 'Hero ad must immediately follow the hero inside main content: ' + pagePath);
  assert.ok(footerAd > page.indexOf('</main>') && footerAd < page.indexOf('<footer'), 'Footer ad must be after main content and before footer: ' + pagePath);
  assert.ok(!page.includes('data-city='), 'Homepage footer city links must be normal links on static pages: ' + pagePath);
}
const expectedCityCount = cityGroups.reduce((sum, group) => sum + JSON.parse(read(group.file)).length, 0);
const communeAudit = auditCommuneSource();
const expectedCommuneCount = communeAudit.total;
const expectedPageCount = expectedCityCount + expectedCommuneCount;
assert.equal(expectedCityCount, 286, 'Expected 286 existing city records');
assert.equal(expectedCommuneCount, 1708, 'Expected all 1,708 Algerian commune records');
assert.equal(urls.length, expectedPageCount + 7, 'XML sitemap must include all city and commune pages plus seven directory/site URLs');
assert.ok(urls.includes('https://imadtbn.github.io/today-weather/sitemap.html'), 'HTML sitemap URL missing from XML sitemap');
const htmlSitemap = read('sitemap.html');
assert.ok(htmlSitemap.includes('<h1 class="city-title">خريطة الموقع</h1>'), 'HTML sitemap H1 missing');
assert.ok(htmlSitemap.includes('id="sitemapSearch"') && htmlSitemap.includes('sitemap-group-grid'), 'HTML sitemap search or city groups missing');
assert.ok(htmlSitemap.includes('rel="canonical" href="https://imadtbn.github.io/today-weather/sitemap.html"'), 'HTML sitemap canonical missing');
assert.ok(htmlSitemap.includes('assets/css/sitemap.css'), 'HTML sitemap stylesheet missing');
assertSharedPageShell(htmlSitemap, 'sitemap.html');
const sitemapJsonLd = [...htmlSitemap.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
assert.equal(sitemapJsonLd.length, 1, 'Expected one JSON-LD block in HTML sitemap');
const sitemapSchema = JSON.parse(sitemapJsonLd[0][1]);
const sitemapCollection = sitemapSchema['@graph']?.find(item => item['@type'] === 'CollectionPage');
assert.ok(sitemapCollection, 'HTML sitemap CollectionPage schema missing');
assert.equal(sitemapCollection.mainEntity?.numberOfItems, expectedPageCount + 12, 'HTML sitemap schema item count mismatch');
assert.equal(sitemapCollection.mainEntity?.itemListElement?.length, expectedPageCount + 12, 'HTML sitemap schema links are incomplete');
assert.ok(htmlSitemap.includes('البلديات الجزائرية') && htmlSitemap.includes('1708 بلدية'), 'HTML sitemap must include the full commune directory');
assert.ok(sitemapSchema['@graph']?.some(item => item['@type'] === 'WebSite' && item['@id'] === 'https://imadtbn.github.io/today-weather/#website'), 'Sitemap WebSite entity link missing');
assert.ok(sitemapSchema['@graph']?.some(item => item['@type'] === 'BreadcrumbList'), 'Sitemap breadcrumb schema missing');
assert.ok(htmlSitemap.includes('href="/today-weather/sitemap.html"'), 'Footer sitemap link missing from generated pages');
const sitemapCss = read('assets/css/sitemap.css');
assert.equal((sitemapCss.match(/{/g) || []).length, (sitemapCss.match(/}/g) || []).length, 'Unbalanced sitemap CSS braces');
assert.equal(new Set(urls).size, urls.length, 'Sitemap contains duplicate URLs');
assert.ok(urls.includes('https://imadtbn.github.io/today-weather/weather/'));
assertSharedPageShell(read('weather/index.html'), 'weather/index.html');
for (const group of cityGroups) assertSharedPageShell(read('weather/' + group.key + '/index.html'), 'weather/' + group.key + '/index.html');
assertSharedPageShell(read('weather/algeria/communes/index.html'), 'weather/algeria/communes/index.html');
const communesDirectory = read('weather/algeria/communes/index.html');
assert.ok(communesDirectory.includes('rel="canonical" href="https://imadtbn.github.io/today-weather/weather/algeria/communes/"'), 'Communes directory canonical missing');
assert.ok(communesDirectory.includes('<h1 class="city-title">دليل البلديات الجزائرية</h1>'), 'Communes directory H1 missing');
assert.equal((communesDirectory.match(/class="sitemap-group"/g) || []).length, 69, 'Communes directory must group entries by all 69 wilayas');
assert.equal((communesDirectory.match(/class="sitemap-entry sitemap-city-entry"/g) || []).length, expectedCommuneCount, 'Communes directory must link all municipalities');
assert.ok(urls.includes('https://imadtbn.github.io/today-weather/weather/algeria/communes/'), 'Communes directory URL missing from XML sitemap');
assert.ok(htmlSitemap.includes('href="/today-weather/weather/algeria/communes/"'), 'Communes directory link missing from HTML sitemap');

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
    const cityWebPage = pageSchema['@graph']?.find(item => item['@type'] === 'WebPage');
    assert.ok(cityWebPage, 'City WebPage schema missing: ' + pagePath);
    assert.equal(cityWebPage.url, 'https://imadtbn.github.io/today-weather/weather/' + group.key + '/' + city.slug + '/', 'City schema URL mismatch: ' + pagePath);
    assert.equal(cityWebPage.isPartOf?.['@id'], 'https://imadtbn.github.io/today-weather/#website', 'City website relation missing: ' + pagePath);
    assert.equal(cityWebPage.publisher?.['@id'], 'https://imadtbn.github.io/today-weather/#organization', 'City publisher relation missing: ' + pagePath);
    assert.ok(pageSchema['@graph']?.some(item => item['@type'] === 'Place' && item.geo), 'Place/GeoCoordinates schema missing: ' + pagePath);
    assert.ok(pageSchema['@graph']?.some(item => item['@type'] === 'BreadcrumbList'), 'Breadcrumb schema missing: ' + pagePath);
    assert.ok(page.includes('assets/css/city-pages.css') && page.includes('assets/js/city-page.js'), 'City page assets missing: ' + pagePath);
    assertSharedPageShell(page, pagePath);
    assert.ok(urls.includes('https://imadtbn.github.io/today-weather/weather/' + group.key + '/' + city.slug + '/'), 'City URL missing from sitemap: ' + city.slug);
  }
}
const normalizedCommunes = communeAudit.communes.map(source => {
  const wilaya = communeAudit.wilayaById.get(String(Number(source.wilaya_id)));
  return { ...buildCommuneWeatherRecord(source, wilaya), id: String(source.id), wilayaId: String(Number(source.wilaya_id)), wilaya };
});
const communeSlugCounts = new Map();
for (const item of normalizedCommunes) { const key = item.wilayaId + '/' + item.slug; communeSlugCounts.set(key, (communeSlugCounts.get(key) || 0) + 1); }
for (const item of normalizedCommunes) if (communeSlugCounts.get(item.wilayaId + '/' + item.slug) > 1) item.slug += '-' + item.id;
const globalSearchIndex = JSON.parse(read('data/global-search-index.json'));
const communeSearchEntries = globalSearchIndex.filter(item => item.type === 'commune');
const globalSearchScript = read('assets/js/global-search.js');
assert.ok(globalSearchScript.includes("item.type === 'commune'") && globalSearchScript.includes('بلدية · '), 'Global search must label commune results as municipalities');
assert.equal(communeSearchEntries.length, expectedCommuneCount, 'Global search index must include every commune');
// Every municipality URL advertised by sitemap.xml must resolve to a generated HTML file.
const sitemapCommuneUrls = urls.filter(url => {
  try { const path = new URL(url).pathname; return path.includes('/weather/algeria/communes/') && !path.endsWith('/weather/algeria/communes/'); }
  catch { return false; }
});
assert.equal(sitemapCommuneUrls.length, expectedCommuneCount,
  'XML sitemap must contain exactly one URL for every commune');
for (const url of sitemapCommuneUrls) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://imadtbn.github.io', 'Unexpected commune sitemap host: ' + url);
  const relativePagePath = parsed.pathname
    .replace(/^\/today-weather\//, '')
    .replace(/\/+$/, '') + '/index.html';
  assert.ok(relativePagePath.startsWith('weather/algeria/communes/'),
    'Invalid commune sitemap path: ' + url);
  assert.ok(existsSync(resolve(root, relativePagePath)),
    'Sitemap commune URL has no matching generated HTML file: ' + relativePagePath);
}
assert.ok(sitemapCommuneUrls.some(url => url.endsWith('/annaba/ain-berda/')),
  'Ain Berda commune URL is missing from XML sitemap');

for (const item of normalizedCommunes) {
  const expectedSearchPath = '/weather/algeria/communes/' + item.wilaya.slug + '/' + item.slug + '/';
  const searchEntry = communeSearchEntries.find(entry => entry.path === expectedSearchPath);
  assert.ok(searchEntry, 'Commune missing from global search index: ' + expectedSearchPath);
  assert.ok(searchEntry.terms.includes(item.name) && searchEntry.terms.includes(item.name_en), 'Commune search must include Arabic and Latin names: ' + expectedSearchPath);
  assert.ok(htmlSitemap.includes('href="/today-weather' + expectedSearchPath + '"'), 'Commune missing from HTML sitemap: ' + expectedSearchPath);
}
for (const item of normalizedCommunes) {
  const pagePath = 'weather/algeria/communes/' + item.wilaya.slug + '/' + item.slug + '/index.html';
  const pageUrl = 'https://imadtbn.github.io/today-weather/weather/algeria/communes/' + item.wilaya.slug + '/' + item.slug + '/';
  assert.ok(existsSync(resolve(root, pagePath)), 'Missing commune weather page: ' + pagePath);
  const page = read(pagePath);
  assert.ok(page.includes('rel="canonical" href="' + pageUrl + '"'), 'Commune canonical mismatch: ' + pagePath);
  assert.ok(page.includes('<h1 class="city-title">طقس بلدية ' + item.name + ' اليوم</h1>'), 'Commune H1 missing: ' + pagePath);
  assert.ok(page.includes('name="robots" content="index,follow,max-image-preview:large,max-snippet:-1"'), 'Commune page must be indexable: ' + pagePath);
  assert.ok(page.includes('data-city-weather=') && page.includes('id="cityForecast"'), 'Commune weather template is incomplete: ' + pagePath);
  const ldMarker = '<script type="application/ld+json">';
  const ldStart = page.indexOf(ldMarker);
  const ldEnd = page.indexOf('</script>', ldStart);
  assert.ok(ldStart >= 0 && ldEnd > ldStart && page.indexOf(ldMarker, ldStart + ldMarker.length) < 0, 'Commune must contain one JSON-LD block: ' + pagePath);
  const graph = JSON.parse(page.slice(ldStart + ldMarker.length, ldEnd))['@graph'];
  const place = graph.find(node => node['@type'] === 'Place');
  assert.equal(place?.geo?.latitude, item.latitude, 'Commune latitude mismatch: ' + pagePath);
  assert.equal(place?.geo?.longitude, item.longitude, 'Commune longitude mismatch: ' + pagePath);
  assert.ok(graph.some(node => node['@type'] === 'BreadcrumbList'), 'Commune breadcrumb schema missing: ' + pagePath);
  assertSharedPageShell(page, pagePath);
  assert.ok(urls.includes(pageUrl), 'Commune URL missing from XML sitemap: ' + pageUrl);
}
for (const wilaya of JSON.parse(read('data/cities.json'))) {
  const statePage = read('weather/algeria/' + wilaya.slug + '/index.html');
  const items = normalizedCommunes.filter(item => item.wilayaId === String(Number(wilaya.code)));
  assert.ok(statePage.includes('بلديات ولاية ' + wilaya.name), 'Wilaya page commune section missing: ' + wilaya.slug);
  assert.ok(items.every(item => statePage.includes('href="/today-weather/weather/algeria/communes/' + wilaya.slug + '/' + item.slug + '/"')), 'Wilaya commune links incomplete: ' + wilaya.slug);
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
for (const host of ['cdnjs.cloudflare.com', 'unpkg.com', 'cdn.jsdelivr.net']) {
  assert.ok(sw.includes(host), 'Static external cache allowlist missing: ' + host);
}
for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
  assert.ok(!sw.includes(host), 'Google Fonts must bypass service-worker interception: ' + host);
}
for (const marker of [
  "const RUNTIME_CACHE_NAME = 'today-weather-runtime-v1'",
  'MAX_RUNTIME_ENTRIES',
  'MAX_CACHED_IMAGES',
  'cacheWriteQueue',
  'clearTimeout(timeoutId)',
  'await trimRuntimeCache(cache)',
  'response.clone()'
]) assert.ok(sw.includes(marker), 'Service worker cache-safety control missing: ' + marker);
assert.ok(!sw.includes('Promise.all(APP_SHELL.map'), 'App shell precache must use bounded concurrency');
assert.ok(sw.indexOf('clearTimeout(timeoutId);') < sw.indexOf('return response;'),
  'Network timeout must be cleared immediately after fetch headers arrive');

assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, 'Unbalanced CSS braces');
const cityCss = read('assets/css/city-pages.css');
assert.equal((cityCss.match(/{/g) || []).length, (cityCss.match(/}/g) || []).length, 'Unbalanced city page CSS braces');
const jsFiles = [
  'assets/js/core.js', 'assets/js/geo-service.js', 'assets/js/weather-service.js', 'assets/js/weather-tips-engine.js',
  'assets/js/ui.js', 'assets/js/map-service.js', 'assets/js/search-news.js',
  'assets/js/effects.js', 'assets/js/image-loader.js', 'assets/js/global-search.js', 'assets/js/app.js', 'assets/js/adsData.js', 'assets/js/city-page.js', 'scripts/seo-schema.mjs', 'sw.js'
];
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, file + ': ' + (result.stderr || result.stdout));
}

const scriptRefs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m => m[1].split(/[?#]/, 1)[0]);
for (const stale of ['assets/js/main.js', 'assets/js/main22script.js', 'assets/js/mainscript.js', 'assets/js/mainscript1.js']) {
  assert.ok(!scriptRefs.includes(stale), 'Legacy script still referenced: ' + stale);
}
const activeJs = readdirSync(resolve(root, 'assets/js')).filter(file => file.endsWith('.js'));
const generatedCityPages = [];
function collectCityPages(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) collectCityPages(absolute);
    else if (entry.isFile() && entry.name === 'index.html') generatedCityPages.push(absolute);
  }
}
collectCityPages(resolve(root, 'weather'));
// Directory landing pages also contain index.html; identify actual city pages by their weather config.
const cityPageFiles = generatedCityPages.filter(path => readFileSync(path, 'utf8').includes('data-city-weather='));
assert.equal(cityPageFiles.length, expectedPageCount, 'Expected all 286 city pages and 1,708 commune pages; found ' + cityPageFiles.length);
const cityPagesUseWeatherScript = cityPageFiles.every(path => readFileSync(path, 'utf8').includes('assets/js/city-page.js'));
assert.ok(cityPagesUseWeatherScript, 'One or more generated city pages do not reference city-page.js');
const unreferenced = activeJs.filter(file =>
  !scriptRefs.includes('assets/js/' + file) &&
  !(file === 'city-page.js' && cityPagesUseWeatherScript)
);
assert.deepEqual(unreferenced, [], 'Unreferenced JavaScript files remain: ' + unreferenced.join(', '));


assert.ok(html.includes('href="/today-weather/weather/algeria/communes/"'), 'Homepage footer commune directory link missing');
assert.ok(html.includes('href="tel:+213697743721"'), 'Clickable contact phone missing');
assert.ok(html.includes('href="mailto:tabaniimadeddine@gmail.com"'), 'Clickable contact email missing');
const homeGraph = JSON.parse(jsonLd[0][1])['@graph'];
const organization = homeGraph.find(item => item['@type'] === 'Organization');
const homeWebsite = homeGraph.find(item => item['@type'] === 'WebSite');
const homeWebPage = homeGraph.find(item => item['@type'] === 'WebPage');
assert.ok(organization?.telephone === '+213697743721', 'Organization telephone schema missing');
assert.ok(organization?.email === 'tabaniimadeddine@gmail.com', 'Organization email schema missing');
assert.ok(homeWebsite && homeWebPage, 'Homepage WebSite/WebPage schema missing');
assert.equal(homeWebPage.isPartOf?.['@id'], homeWebsite['@id'], 'Homepage WebPage-to-WebSite relation missing');
assert.equal(homeWebPage.publisher?.['@id'], organization['@id'], 'Homepage WebPage publisher relation missing');
const weatherIndex = read('weather/index.html');
const weatherIndexLd = [...weatherIndex.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
assert.equal(weatherIndexLd.length, 1, 'Weather directory landing page JSON-LD missing');
const weatherIndexGraph = JSON.parse(weatherIndexLd[0][1])['@graph'];
assert.ok(weatherIndexGraph.some(item => item['@type'] === 'WebPage'), 'Weather directory WebPage schema missing');
assert.ok(html.includes('weather forecast') && html.includes('météo Algérie'), 'Multilingual weather search terms missing');
assert.ok(html.includes('id="weather-guide-title"'), 'Indexable weather guide content missing');
const homeHeroStart = html.indexOf('class="hero-section"');
const homeHeroEnd = html.indexOf('</section>', homeHeroStart);
const homeHeroAd = html.indexOf('data-ad-slot="7867079394"');
const homeFooterAd = html.indexOf('data-ad-slot="6528123169"');
const homeFooter = html.indexOf('<footer class="site-footer"');
assert.ok(homeHeroStart >= 0 && homeHeroEnd > homeHeroStart && homeHeroAd > homeHeroEnd && homeHeroAd < html.indexOf('id="currentWeather"'), 'Homepage hero ad must appear immediately after the hero');
assert.ok(homeFooterAd > html.indexOf('</main>') && homeFooterAd < homeFooter, 'Homepage footer ad must appear between main and footer');
assert.ok(html.slice(html.lastIndexOf('<div class="ad-container"', homeFooterAd), homeFooterAd).includes('data-ad-placement="footer"'), 'Homepage footer ad must use the approved footer placement container');
console.log('Site validation passed: HTML, SEO, JSON-LD, sitemap, PWA cache, CSS and JavaScript.');
