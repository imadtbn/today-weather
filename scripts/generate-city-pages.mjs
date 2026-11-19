import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageGraph, collectionGraph } from './seo-schema.mjs';
import { auditCommuneSource, buildCommuneWeatherRecord } from './communes-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://imadtbn.github.io/today-weather';
const BASE = '/today-weather';
const TODAY = new Date().toISOString().slice(0, 10);
const missingImages = [];
const readJson = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const groups = [
  {
    key: 'algeria', title: 'الولايات الجزائرية', kind: 'ولاية جزائرية',
    description: 'تصفح صفحات الطقس للولايات الجزائرية الـ69، مع درجات الحرارة الحالية وتوقعات خمسة أيام لكل ولاية.',
    items: readJson('data/cities.json'),
    name: city => city.name, country: () => 'الجزائر',
    region: city => city.region || 'الجزائر', lat: city => city.latitude, lon: city => city.longitude
  },
  {
    key: 'arab', title: 'العواصم العربية', kind: 'عاصمة عربية',
    description: 'تابع حالة الطقس وتوقعات خمسة أيام في العواصم العربية، مع معلومات الموقع وصور المدن وروابط داخلية.',
    items: readJson('data/arab-capitals.json'),
    name: city => city.capital, country: city => city.country,
    region: () => 'العواصم العربية', lat: city => city.latitude, lon: city => city.longitude
  },
  {
    key: 'world', title: 'المدن والعواصم العالمية', kind: 'مدينة عالمية',
    description: 'اكتشف الطقس الحالي والتوقعات اليومية في عواصم ومدن العالم عبر صفحات مستقلة قابلة للفهرسة.',
    items: readJson('data/world-capitals.json'),
    name: city => city.capital, country: city => city.country,
    region: city => city.continentName || 'مدينة عالمية', lat: city => city.latitude, lon: city => city.longitude
  }
];

function imagePath(city) {
  const raw = String(city.countryImages || '').replace(/^\/+/, '');
  const local = raw.startsWith('today-weather/') ? raw.slice('today-weather/'.length) : raw;
  if (local && existsSync(join(ROOT, local))) return `${BASE}/${local}`;
  missingImages.push({ slug: city.slug, expected: local || 'countryImages not set' });
  return `${BASE}/assets/images/icon1.webp`;
}
function writePage(path, html) {
  const absolute = join(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, html + '\n', 'utf8');
}
function pageUrl(group, slug) {
  return `${SITE}/weather/${group}/${slug}/`;
}



const HOME_HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
function homeSection(tag) {
  const match = HOME_HTML.match(new RegExp('<' + tag + '\\b[\\s\\S]*?<\\/' + tag + '>'));
  if (!match) throw new Error('Homepage ' + tag + ' markup is missing');
  return match[0];
}
function trackingTags() {
  return '<meta name="google-site-verification" content="f5Xi4oFx0v5dN6iPZd9qCw-7vnc3vIbAeYF9jr4vwVM">' +
    '<meta name="msvalidate.01" content="9BCA38377A234DCCEB9991EAD1A2F6C2">' +
    '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-PTCXG7CG"></script>' +
    '<script>window.dataLayer = window.dataLayer || []; function gtag() { dataLayer.push(arguments); } gtag("js", new Date());</script>' +
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5656416032906373" crossorigin="anonymous"></script>';
}
function commonHeader() {
  let header = homeSection('header')
    .replace(/src="assets\//g, 'src="' + BASE + '/assets/')
    .replace(/href="#"/g, 'href="' + BASE + '/"')
    .replace(/href="#([^"]+)"/g, 'href="' + BASE + '/#$1"')
    .replace('class="nav-link active"', 'class="nav-link"');
  return header;
}
const SITE_SEARCH_PAGES = [
  { type: 'page', name: 'الصفحة الرئيسية', detail: 'الطقس اليوم وحالة الطقس الحالية', path: '/', terms: 'الرئيسية الطقس اليوم أحوال الطقس حالة الطقس' },
  { type: 'page', name: 'دليل الطقس', detail: 'جميع المدن والولايات والعواصم', path: '/weather/', terms: 'دليل المدن بحث عالمي مدن عواصم' },
  { type: 'page', name: 'الولايات الجزائرية', detail: 'الطقس في 69 ولاية ومدينة جزائرية', path: '/weather/algeria/', terms: 'الجزائر ولايات مدن الجزائر' },
  { type: 'page', name: 'العواصم العربية', detail: 'الطقس في العواصم والمدن العربية', path: '/weather/arab/', terms: 'العالم العربي عواصم عربية' },
  { type: 'page', name: 'المدن والعواصم العالمية', detail: 'الطقس حول العالم', path: '/weather/world/', terms: 'العالم مدن دول عواصم عالمية' },
  { type: 'section', name: 'توقعات الطقس', detail: 'توقعات الأيام الخمسة القادمة', path: '/#forecast', terms: 'توقعات خمسة أيام أسبوع forecast' },
  { type: 'section', name: 'الأقسام المتخصصة', detail: 'الطقس الزراعي والبحري وجودة الهواء والأمطار', path: '/#specialized', terms: 'طقس زراعي بحري جودة الهواء أمطار' },
  { type: 'section', name: 'الطقس الزراعي', detail: 'مؤشرات الطقس للزراعة', path: '/#agricultureCard', terms: 'زراعة فلاحة ري محاصيل' },
  { type: 'section', name: 'الطقس البحري', detail: 'حالة البحر والرياح', path: '/#marineCard', terms: 'بحر أمواج ملاحة' },
  { type: 'section', name: 'جودة الهواء', detail: 'مؤشرات الهواء والتلوث', path: '/#airCard', terms: 'هواء تلوث جودة الهواء' },
  { type: 'section', name: 'الأمطار', detail: 'معلومات ومؤشرات هطول الأمطار', path: '/#rainfallCard', terms: 'أمطار تساقط هطول' },
  { type: 'section', name: 'خرائط الطقس', detail: 'الخرائط الجوية التفاعلية', path: '/#maps', terms: 'خريطة خرائط رادار الطقس' },
  { type: 'section', name: 'إحصائيات الطقس', detail: 'إحصائيات ومؤشرات الطقس', path: '/#stats', terms: 'إحصائيات درجات الحرارة بيانات' },
  { type: 'section', name: 'التحذيرات الجوية', detail: 'تنبيهات وتحذيرات الطقس', path: '/#warnings', terms: 'تحذير تنبيه طقس خطر' },
  { type: 'section', name: 'أخبار الطقس', detail: 'آخر أخبار الطقس والمناخ', path: '/#news', terms: 'أخبار مناخ' },
  { type: 'section', name: 'دليل الطقس والمعلومات', detail: 'معلومات وإرشادات الطقس', path: '/#weather-guide', terms: 'دليل معلومات نصائح الطقس' }
];

function buildGlobalSearchIndex() {
  const cities = groups.flatMap(group => group.items.map(city => ({
    type: 'city',
    name: group.name(city),
    detail: group.country(city),
    latin: city.name_en || city.name_fr || city.englishName || '',
    terms: [city.name_en, city.name_fr, city.englishName, city.slug, city.countryCode, group.title].filter(Boolean).join(' '),
    path: `/weather/${group.key}/${encodeURIComponent(city.slug)}/`
  })));
  return [...SITE_SEARCH_PAGES, ...cities];
}

function commonFooter() {
  let footer = homeSection('footer').replace(/src="assets\//g, 'src="' + BASE + '/assets/');
  footer = footer.replace(/<a href="#" data-city="([^"]+)">/g, (match, cityName) => {
    const city = groups[0].items.find(item =>
      String(item.name_en || '').toLowerCase() === cityName.toLowerCase()
    );
    return city
      ? '<a href="' + BASE + '/weather/algeria/' + encodeURIComponent(city.slug) + '/">'
      : '<a href="' + BASE + '/weather/algeria/">';
  });
  footer = footer.replace(/href="#"([^>]*>)/g, 'href="' + BASE + '/"$1')
    .replace(/href="#([^"]+)"([^>]*>)/g, 'href="' + BASE + '/#$1"$2');
  return footer +
    '<script defer src="' + BASE + '/assets/js/adsData.js?v=20261115-ads-fix"></script>' +
    '<script defer src="' + BASE + '/assets/js/global-search.js?v=20261115-sitemap-footer-1"></script>' +
    '<script>(function(){' +
    'var menu=document.getElementById("mobileMenuBtn"),nav=document.getElementById("mainNav");' +
    'if(menu&&nav){menu.addEventListener("click",function(){var open=nav.classList.toggle("active");menu.setAttribute("aria-expanded",String(open));menu.setAttribute("aria-label",open?"إغلاق قائمة التنقل":"فتح قائمة التنقل");});' +
    'nav.querySelectorAll("a").forEach(function(a){a.addEventListener("click",function(){nav.classList.remove("active");menu.setAttribute("aria-expanded","false");});});' +
    'document.addEventListener("keydown",function(e){if(e.key==="Escape"){nav.classList.remove("active");menu.setAttribute("aria-expanded","false");}});}' +
    'var locationButton=document.getElementById("locationBtn");if(locationButton)locationButton.addEventListener("click",function(){location.href="' + BASE + '/#home";});' +
    '})();</script>';
}


function buildSitemapPage() {
  const pageLinks = [
    { name: 'الصفحة الرئيسية', detail: 'حالة الطقس اليوم والتحديثات الجوية', path: '/', terms: 'الرئيسية الطقس اليوم' },
    { name: 'دليل الطقس', detail: 'جميع أدلة المدن والولايات والعواصم', path: '/weather/', terms: 'دليل الطقس المدن' },
    { name: 'الولايات الجزائرية', detail: 'دليل الطقس في الولايات الجزائرية', path: '/weather/algeria/', terms: 'الجزائر الولايات' },
    { name: 'العواصم العربية', detail: 'توقعات الطقس في العواصم العربية', path: '/weather/arab/', terms: 'العواصم العربية' },
    { name: 'المدن والعواصم العالمية', detail: 'توقعات الطقس حول العالم', path: '/weather/world/', terms: 'مدن العالم عواصم' },
    { name: 'توقعات الطقس', detail: 'التوقعات الجوية للأيام القادمة', path: '/#forecast', terms: 'توقعات forecast' },
    { name: 'خرائط الطقس', detail: 'الخرائط الجوية التفاعلية', path: '/#maps', terms: 'خرائط رادار' },
    { name: 'الإحصائيات', detail: 'مؤشرات وإحصائيات الطقس', path: '/#stats', terms: 'إحصائيات' },
    { name: 'التحذيرات الجوية', detail: 'التنبيهات والتحذيرات الجوية', path: '/#warnings', terms: 'تحذيرات تنبيهات' },
    { name: 'أخبار الطقس', detail: 'أخبار الطقس والمناخ', path: '/#news', terms: 'أخبار مناخ' },
    { name: 'الأقسام المتخصصة', detail: 'الطقس الزراعي والبحري وجودة الهواء والأمطار', path: '/#specialized', terms: 'زراعي بحري هواء أمطار' }
  ];
  const pageItems = pageLinks.map(item =>
    '<a class="sitemap-entry sitemap-page-entry" href="' + BASE + item.path + '" data-search="' +
    escapeHtml([item.name, item.detail, item.terms].join(' ').toLowerCase()) + '">' +
    '<span class="sitemap-entry-icon"><i class="fas fa-link" aria-hidden="true"></i></span>' +
    '<span class="sitemap-entry-copy"><strong>' + escapeHtml(item.name) + '</strong><small>' +
    escapeHtml(item.detail) + '</small></span><i class="fas fa-arrow-left sitemap-entry-arrow" aria-hidden="true"></i></a>'
  ).join('');
  const groupSections = groups.map(group => {
    const entries = group.items.map(city => {
      const name = group.name(city);
      const country = group.country(city);
      const english = city.englishName || city.name_en || city.name_fr || city.slug || '';
      const terms = [name, country, english, city.slug, city.countryCode, city.name_fr].filter(Boolean).join(' ').toLowerCase();
      const href = BASE + '/weather/' + group.key + '/' + encodeURIComponent(city.slug) + '/';
      return '<a class="sitemap-entry sitemap-city-entry" href="' + href + '" data-search="' +
        escapeHtml(terms) + '"><span class="sitemap-entry-icon"><i class="fas fa-location-dot" aria-hidden="true"></i></span>' +
        '<span class="sitemap-entry-copy"><strong>' + escapeHtml(name) + '</strong><small>' +
        escapeHtml([country, english].filter(Boolean).join(' · ')) +
        '</small></span><i class="fas fa-arrow-left sitemap-entry-arrow" aria-hidden="true"></i></a>';
    }).join('');
    return '<details class="sitemap-group" open><summary><span class="sitemap-group-title">' +
      escapeHtml(group.title) + '</span><span class="sitemap-group-count">' + group.items.length +
      ' رابطاً</span></summary><div class="sitemap-group-grid">' + entries + '</div></details>';
  }).join('');
  const totalCities = groups.reduce((sum, group) => sum + group.items.length, 0);
  const totalLinks = totalCities + pageLinks.length;
  const pageSchemaItems = pageLinks.map((item, index) => ({
    '@type': 'ListItem', position: index + 1, name: item.name, url: SITE + item.path
  }));
  let schemaPosition = pageSchemaItems.length;
  const citySchemaItems = groups.flatMap(group => group.items.map(city => {
    schemaPosition++;
    return {
      '@type': 'ListItem', position: schemaPosition,
      name: group.name(city), url: pageUrl(group.key, city.slug)
    };
  }));
  const sitemapUrl = SITE + '/sitemap.html';
  const schema = collectionGraph({
    url: sitemapUrl,
    name: 'خريطة الموقع | أحوال الطقس',
    description: 'دليل شامل لجميع صفحات الطقس والولايات الجزائرية والعواصم العربية والمدن العالمية.',
    dateModified: TODAY,
    breadcrumbs: [
      { name: 'الرئيسية', url: SITE + '/' },
      { name: 'خريطة الموقع', url: sitemapUrl }
    ],
    items: [
      ...pageLinks.map(item => ({ name: item.name, url: SITE + item.path })),
      ...groups.flatMap(group => group.items.map(city => ({
        name: group.name(city), url: pageUrl(group.key, city.slug)
      })))
    ]
  });
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>خريطة الموقع | جميع المدن والولايات والعواصم - أحوال الطقس</title>' +
    '<meta name="description" content="تصفح جميع صفحات أحوال الطقس: الولايات الجزائرية والعواصم العربية والمدن العالمية، وابحث عن أي مدينة بالعربية أو الإنجليزية.">' +
    '<meta name="robots" content="index,follow,max-image-preview:large">' +
    '<link rel="canonical" href="' + SITE + '/sitemap.html">' +
    '<meta property="og:type" content="website"><meta property="og:locale" content="ar_DZ">' +
    '<meta property="og:title" content="خريطة الموقع | أحوال الطقس">' +
    '<meta property="og:description" content="دليل شامل لجميع صفحات الطقس والمدن والولايات والعواصم.">' +
    '<meta property="og:url" content="' + SITE + '/sitemap.html">' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap">' +
    '<link rel="stylesheet" href="' + BASE + '/assets/css/style-main.css">' +
    '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">' +
    '<link rel="stylesheet" href="' + BASE + '/assets/css/city-pages.css">' +
    '<link rel="stylesheet" href="' + BASE + '/assets/css/sitemap.css">' +
    trackingTags() + '<script type="application/ld+json">' + safeJson(schema) + '</script></head>' +
    '<body class="city-page sitemap-page">' + commonHeader() + adBlock("top") +
    '<main class="city-container sitemap-container"><nav class="city-breadcrumb" aria-label="مسار التنقل">' +
    '<a href="' + BASE + '/">الرئيسية</a> / خريطة الموقع</nav>' +
    '<header class="sitemap-hero"><span class="city-kicker">دليل التصفح</span>' +
    '<h1 class="city-title">خريطة الموقع</h1><p class="city-directory-intro">استكشف جميع أقسام وصفحات أحوال الطقس، ' +
    'أو ابحث عن أي ولاية أو عاصمة أو مدينة باسمها العربي أو الإنجليزي.</p>' +
    '<div class="sitemap-stats"><div><strong>' + totalCities + '</strong><span>مدينة وعاصمة</span></div>' +
    '<div><strong>' + groups.length + '</strong><span>أدلة جغرافية</span></div>' +
    '<div><strong>' + totalLinks + '</strong><span>رابطاً قابلاً للتصفح</span></div></div></header>' +
    '<section class="sitemap-search-panel" aria-label="البحث في خريطة الموقع">' +
    '<label for="sitemapSearch">ابحث عن مدينة أو قسم</label><div class="sitemap-search-box">' +
    '<i class="fas fa-search" aria-hidden="true"></i><input id="sitemapSearch" type="search" ' +
    'placeholder="مثال: الجزائر، Paris، Cairo..." autocomplete="off" aria-controls="sitemapContent">' +
    '<button id="sitemapClear" type="button" aria-label="مسح البحث" hidden><i class="fas fa-times" aria-hidden="true"></i></button>' +
    '</div><p id="sitemapSearchStatus" role="status" aria-live="polite">تصفح ' + totalLinks + ' رابطاً.</p></section>' +
    '<div id="sitemapContent"><section class="sitemap-section"><h2><i class="fas fa-compass" aria-hidden="true"></i> الصفحات والأقسام</h2>' +
    '<div class="sitemap-page-grid">' + pageItems + '</div></section>' +
    '<section class="sitemap-section"><h2><i class="fas fa-earth-africa" aria-hidden="true"></i> المدن والوجهات</h2>' +
    '<div class="sitemap-groups">' + groupSections + '</div></section></div>' +
    '<p class="sitemap-no-results" id="sitemapNoResults" hidden>لا توجد نتائج مطابقة. جرّب اسماً آخر بالعربية أو الإنجليزية.</p>' +
    '</main>' + adBlock("bottom") + commonFooter() +
    '<script>(function(){var input=document.getElementById("sitemapSearch"),clear=document.getElementById("sitemapClear"),' +
    'status=document.getElementById("sitemapSearchStatus"),empty=document.getElementById("sitemapNoResults");' +
    'var entries=Array.from(document.querySelectorAll(".sitemap-entry")),groupsList=Array.from(document.querySelectorAll(".sitemap-group"));' +
    'function normalize(value){return String(value||"").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g,"").trim();}' +
    'function filter(){var query=normalize(input.value),shown=0;entries.forEach(function(entry){var match=!query||normalize(entry.dataset.search+" "+entry.textContent).includes(query);entry.hidden=!match;if(match)shown++;});' +
    'groupsList.forEach(function(group){var visible=group.querySelectorAll(".sitemap-entry:not([hidden])").length;group.hidden=visible===0;if(query&&visible)group.open=true;});' +
    'var pages=document.querySelector(".sitemap-page-grid"),pageVisible=pages&&pages.querySelectorAll(".sitemap-entry:not([hidden])").length; ' +
    'var pageSection=pages&&pages.closest(".sitemap-section");if(pageSection)pageSection.hidden=pageVisible===0;' +
    'var citySection=groupsList[0]&&groupsList[0].closest(".sitemap-section");if(citySection)citySection.hidden=groupsList.every(function(group){return group.hidden;});' +
    'empty.hidden=shown!==0;clear.hidden=!input.value;status.textContent=query?("عدد النتائج: "+shown):("تصفح "+entries.length+" رابطاً.");}' +
    'input.addEventListener("input",filter);clear.addEventListener("click",function(){input.value="";filter();input.focus();});})();</script>' +
    '</body></html>';
}

function adBlock(position) {
  const unit = position === 'top'
    ? '<ins class="adsbygoogle" style="display:block;width:100%;min-height:90px" data-ad-format="fluid" data-ad-layout-key="-fr+56+4k-d4+74" data-ad-client="ca-pub-5656416032906373" data-ad-slot="7867079394"></ins>'
    : '<ins class="adsbygoogle" style="display:block;width:100%;min-height:90px" data-ad-client="ca-pub-5656416032906373" data-ad-slot="3143411927" data-ad-format="auto" data-full-width-responsive="true"></ins>';
  return '<div class="container city-ad-wrap"><div class="ad-container" data-ad-placement="' + position + '"><span class="ad-label">إعلان</span><div class="ad-placeholder">' + unit + '</div></div></div>';
}

function buildDirectory(group) {
  const batchSize = 4;
  const links = group.items.map((city, index) => {
    const image = imagePath(city);
    const englishName = city.englishName || city.name_en || city.name_fr || '';
    const worldCountry = groups.find(item => item.key === 'world')?.items.find(item => item.countryCode === city.countryCode);
    const continent = city.continentName || city.continent || worldCountry?.continentName || (group.key === 'algeria' ? 'إفريقيا' : '');
    const phone = city.countryPhone || '';
    const code = city.countryCode || '';
    const subtitle = [group.country(city), continent].filter(Boolean).join(' · ');
    const deferredImage = index >= batchSize;
    const imageSource = deferredImage ? 'data-src' : 'src';
    const hidden = deferredImage ? ' hidden' : '';
    return `<a class="city-directory-item" href="${BASE}/weather/${group.key}/${encodeURIComponent(city.slug)}/"${hidden}
      data-country-code="${escapeHtml(code)}" data-country-phone="${escapeHtml(phone)}"
      data-english-name="${escapeHtml(englishName)}" data-continent="${escapeHtml(continent)}">
      <img class="directory-city-image" ${imageSource}="${image}" alt="${escapeHtml('صورة ' + group.name(city) + ' - ' + group.country(city))}"
        width="640" height="400" loading="lazy" decoding="async">
      <span class="directory-city-body"><strong>${escapeHtml(group.name(city))}</strong>
      <small class="directory-country">${escapeHtml(subtitle)}</small>
      <span class="directory-city-meta"><span><bdi>${escapeHtml(code || '—')}</bdi></span>
      <span><bdi>${escapeHtml(phone || '—')}</bdi></span>
      <span lang="en" dir="ltr">${escapeHtml(englishName || '')}</span></span></span></a>`;
  }).join('\n');
  const url = `${SITE}/weather/${group.key}/`;
  const directoryImage = group.key === 'algeria' ? 'images/algiers.jpg' : group.key === 'arab' ? 'images/amman.jpg' : 'images/world-cities2.jpg?v=20261115';
  const directoryImageAlt = group.key === 'algeria' ? 'مشهد من الجزائر العاصمة يمثل دليل الولايات الجزائرية' : group.key === 'arab' ? 'مشهد من عمّان يمثل دليل العواصم العربية' : 'رسم لمدن عالمية ومعالم عمرانية يمثل دليل المدن العالمية';
  const schema = collectionGraph({
    url,
    name: `الطقس في ${group.title}`,
    description: group.description,
    image: `${SITE}/${directoryImage}`,
    dateModified: TODAY,
    breadcrumbs: [
      { name: 'الرئيسية', url: SITE + '/' },
      { name: 'دليل الطقس', url: SITE + '/weather/' },
      { name: group.title, url }
    ],
    items: group.items.map(city => ({
      name: group.name(city), url: pageUrl(group.key, city.slug)
    }))
  });
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>الطقس في ${escapeHtml(group.title)} | أحوال الطقس</title><meta name="description" content="${escapeHtml(group.description)}"><meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:locale" content="ar_DZ"><meta property="og:title" content="الطقس في ${escapeHtml(group.title)}"><meta property="og:description" content="${escapeHtml(group.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/${directoryImage}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap"><link rel="stylesheet" href="${BASE}/assets/css/style-main.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><link rel="stylesheet" href="${BASE}/assets/css/city-pages.css">${trackingTags()}<script type="application/ld+json">${safeJson(schema)}</script></head>
<body class="city-page">${commonHeader()}${adBlock("top")}
<main class="city-container city-directory"><nav class="city-breadcrumb"><a href="${BASE}/">الرئيسية</a> / <a href="${BASE}/weather/">دليل الطقس</a> / ${escapeHtml(group.title)}</nav>
<header class="directory-hero"><div class="directory-hero-content"><span class="city-kicker">دليل الطقس · ${escapeHtml(group.kind)}</span><h1 class="city-title">${escapeHtml(group.title)}</h1><p class="city-directory-intro">${escapeHtml(group.description)}</p><span class="directory-count">استكشف ${group.items.length} مدينة</span></div><figure class="directory-hero-media"><img src="${BASE}/${directoryImage}" alt="${escapeHtml(directoryImageAlt)}" width="960" height="620" loading="eager" fetchpriority="high" decoding="async"></figure></header>
<div class="city-directory-grid">${links}</div></main>
${adBlock("bottom")}${commonFooter()}
<script>(function(){var grid=document.querySelector('.city-directory-grid');if(!grid)return;var cards=Array.from(grid.children);var batchSize=window.matchMedia('(max-width: 600px)').matches?4:12;var shown=0;var observer=null;var sentinel=document.createElement('div');sentinel.className='directory-load-sentinel';sentinel.setAttribute('role','status');sentinel.setAttribute('aria-live','polite');sentinel.textContent='جارٍ تحميل المزيد من المدن…';function revealCard(card){card.hidden=false;var img=card.querySelector('img[data-src]');if(img){img.setAttribute('src',img.dataset.src);img.removeAttribute('data-src');}card.classList.add('is-visible');}function revealBatch(){var end=Math.min(shown+batchSize,cards.length);for(var i=shown;i<end;i++)revealCard(cards[i]);shown=end;if(shown>=cards.length){sentinel.hidden=true;if(observer)observer.disconnect();}else{sentinel.hidden=false;}}grid.classList.add('directory-progressive');grid.insertAdjacentElement('afterend',sentinel);if(!('IntersectionObserver'in window)){cards.forEach(revealCard);sentinel.remove();return;}observer=new IntersectionObserver(function(entries){if(entries.some(function(entry){return entry.isIntersecting;}))revealBatch();},{rootMargin:'0px',threshold:0});revealBatch();if(shown<cards.length)observer.observe(sentinel);})();</script>
</body></html>`;
}

function buildCityPage(group, index) {
  const city = group.items[index];
  const name = group.name(city), country = group.country(city);
  const latitude = Number(group.lat(city)), longitude = Number(group.lon(city));
  if (!city.slug || !name || !country || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error(`Invalid city data in ${group.key} at index ${index}`);
  }
  const url = group.pageUrl ? group.pageUrl(city) : pageUrl(group.key, city.slug);
  const image = imagePath(city);
  const title = `طقس ${group.pageKindLabel ? group.pageKindLabel + ' ' : ''}${name} اليوم | حالة الطقس وتوقعات 5 أيام`;
  const description = group.pageKindLabel
    ? `تعرف على طقس ${name}، ${group.pageKindLabel} في ${group.parentName || group.title}، ${country}: درجات الحرارة الحالية، الحالة الجوية، الرطوبة والرياح، وتوقعات الطقس لمدة خمسة أيام حسب الإحداثيات المحلية.`
    : `تعرف على طقس ${name} في ${country}: درجات الحرارة الحالية، الحالة الجوية، الرطوبة والرياح، وتوقعات الطقس لمدة خمسة أيام حسب الإحداثيات المحلية.`;
  const related = Array.from({ length: Math.min(8, group.items.length - 1) }, (_, offset) =>
    group.items[(index + offset + 1) % group.items.length]
  ).filter(item => item.slug !== city.slug);
  const relatedLinks = related.map(item =>
    `<a href="${group.pagePath ? group.pagePath(item) : `${BASE}/weather/${group.key}/${encodeURIComponent(item.slug)}/`}">${escapeHtml(group.name(item))}</a>`
  ).join('');
  const breadcrumb = [
    { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'دليل الطقس', item: `${SITE}/weather/` },
    { '@type': 'ListItem', position: 3, name: group.title, item: group.directoryUrl || `${SITE}/weather/${group.key}/` },
    { '@type': 'ListItem', position: 4, name, item: url }
  ];
  const schema = pageGraph({
    url, name: title, description, image: SITE + image, dateModified: TODAY,
    breadcrumbs: [
      { name: 'الرئيسية', url: SITE + '/' },
      { name: 'دليل الطقس', url: SITE + '/weather/' },
      { name: group.title, url: group.directoryUrl || SITE + '/weather/' + group.key + '/' },
      { name, url }
    ],
    mainEntity: { '@id': url + '#place' }
  });
  schema['@graph'].push({
    '@type': 'Place',
    '@id': url + '#place',
    name,
    containedInPlace: { '@type': 'Country', name: country },
    geo: { '@type': 'GeoCoordinates', latitude, longitude }
  });
  const config = safeJson({ lat: latitude, lon: longitude, name, country, countryCode: city.countryCode || city.country_code || (group.key === 'algeria' ? 'DZ' : '') });
  const imageAlt = `صورة ${name} في ${country}`;
  const groupLabel = group.key === 'algeria' ? 'الولايات الجزائرية' : group.key === 'arab' ? 'العواصم العربية' : 'المدن العالمية';
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${escapeHtml(group.robotsDirective || "index,follow,max-image-preview:large,max-snippet:-1")}">
<link rel="canonical" href="${url}"><meta name="theme-color" content="#0a0e1a">
<meta property="og:type" content="website"><meta property="og:locale" content="ar_DZ"><meta property="og:site_name" content="أحوال الطقس"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE + image}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${SITE + image}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><link rel="stylesheet" href="${BASE}/assets/css/style-main.css"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><link rel="stylesheet" href="${BASE}/assets/css/city-pages.css">
${trackingTags()}<script type="application/ld+json">${safeJson(schema)}</script></head>
<body class="city-page">${commonHeader()}${adBlock("top")}
<main class="city-container" data-city-weather='${escapeHtml(config)}'>
<nav class="city-breadcrumb" aria-label="مسار التنقل"><a href="${BASE}/">الرئيسية</a> / <a href="${BASE}/weather/">دليل الطقس</a> / <a href="${group.directoryPath || `${BASE}/weather/${group.key}/`}">${escapeHtml(group.title)}</a> / ${escapeHtml(name)}</nav>
<section class="city-hero"><div class="city-hero-grid"><div><span class="city-kicker">${escapeHtml(group.kind)} · ${escapeHtml(country)}</span><h1 class="city-title">طقس ${escapeHtml(group.pageKindLabel ? group.pageKindLabel + " " : "")}${escapeHtml(name)} اليوم</h1><p class="city-subtitle">تابع حالة الطقس في ${escapeHtml(name)}، ${escapeHtml(country)}، واطلع على درجات الحرارة الحالية وتوقعات الأيام الخمسة القادمة. تعتمد بيانات هذه الصفحة على الإحداثيات الجغرافية للمدينة (${latitude.toFixed(4)}، ${longitude.toFixed(4)}) لعرض معلومات جوية مرتبطة بموقعها.</p></div>
<figure class="city-image-wrap"><img src="${image}" alt="${escapeHtml(imageAlt)}" width="960" height="600" fetchpriority="high" decoding="async"></figure></div></section>
<section class="city-weather" aria-labelledby="cityWeatherTitle"><div class="city-weather-card"><div class="city-weather-head"><h2 id="cityWeatherTitle">حالة الطقس الحالية في ${escapeHtml(name)}</h2><span class="city-live-label"><i class="fa-solid fa-circle" aria-hidden="true"></i> بيانات مباشرة</span></div>
<div class="city-current"><div><div class="city-temp" id="cityTemp" aria-live="polite">--°</div><p class="city-condition" id="cityCondition">جارٍ تحميل حالة الطقس...</p></div><i id="cityWeatherIcon" class="fa-solid fa-cloud city-weather-icon" aria-hidden="true"></i></div>
<div class="city-metrics">
<div class="city-metric"><strong id="cityFeels">--</strong><span>الحرارة المحسوسة</span></div>
<div class="city-metric"><strong id="cityHumidity">--</strong><span>الرطوبة</span></div>
<div class="city-metric"><strong id="cityWind">--</strong><span>سرعة الرياح</span></div>
<div class="city-metric"><strong id="cityPressure">--</strong><span>الضغط الجوي</span></div>
<div class="city-metric"><strong id="cityVisibility">--</strong><span>مدى الرؤية</span></div>
<div class="city-metric"><strong id="cityDewPoint">--</strong><span>نقطة الندى التقديرية</span></div>
<div class="city-metric"><strong id="cityUv">--</strong><span>مؤشر الأشعة UV</span></div>
<div class="city-metric"><strong id="cityClouds">--</strong><span>الغطاء السحابي</span></div>
<div class="city-metric"><strong id="cityWindDirection">--</strong><span>اتجاه الرياح</span></div>
<div class="city-metric"><strong id="citySunrise">--</strong><span>الشروق</span></div>
<div class="city-metric"><strong id="citySunset">--</strong><span>الغروب</span></div>
<div class="city-metric"><strong id="cityCountryCode">--</strong><span>رمز الدولة</span></div>
</div>
<p class="city-status" id="cityStatus" role="status">يتم الاتصال بمصدر بيانات الطقس...</p><p class="city-status" id="cityUpdated"></p><button id="cityRefresh" type="button" class="city-refresh">تحديث الطقس</button></div>
<div class="city-hourly city-forecast-card"><h2 class="city-section-title">توقعات الطقس كل 3 ساعات خلال 24 ساعة القادمة</h2><div class="hourly-scroll"><div class="hourly-container" id="hourlyForecast"><p class="city-status">جارٍ تحميل التوقعات الساعية...</p></div></div></div>
<div class="city-forecast city-forecast-card"><h2 class="city-section-title">توقعات الطقس لمدة خمسة أيام في ${escapeHtml(name)}</h2><div class="city-forecast-grid" id="cityForecast"><p class="city-status">جارٍ تحميل التوقعات...</p></div></div></section>
<section class="specialized-section city-extra-section" id="specialized"><div class="city-section-heading"><h2 class="city-section-title">الأقسام المتخصصة</h2><span id="specializedLocation">${escapeHtml(name)} · ${escapeHtml(country)}</span></div>
<div class="specialized-grid">
<article class="specialized-card agriculture-card" id="agricultureCard"><h3>المؤشرات الزراعية</h3><div class="city-extra-values"><span>التبخر المرجعي <b id="agriEt0">--</b></span><span>رطوبة التربة <b id="agriSoil">--</b></span><span>الأمطار المتوقعة <b id="agriRain">--</b></span></div><p class="specialized-advice" id="agriAdvice">جارٍ تحميل البيانات الزراعية...</p></article>
<article class="specialized-card marine-card" id="marineCard"><h3>حالة البحر والأمواج</h3><div class="city-extra-values"><span>ارتفاع الموج <b id="marineWave">--</b></span><span>اتجاه الموج <b id="marineDirection">--</b></span><span>فترة الموج <b id="marinePeriod">--</b></span></div><p class="specialized-advice" id="marineAdvice">جارٍ تحميل البيانات البحرية...</p></article>
<article class="specialized-card air-card" id="airCard"><h3>جودة الهواء</h3><div class="city-extra-values"><span>المؤشر الأوروبي <b id="airAqi">--</b></span><span>PM2.5 <b id="airPm25">--</b></span><span>PM10 <b id="airPm10">--</b></span></div><p class="specialized-advice" id="airAdvice">جارٍ تحميل جودة الهواء...</p></article>
<article class="specialized-card rainfall-card" id="rainfallCard"><h3>مؤشرات الأمطار</h3><div class="city-extra-values"><span>خلال 24 ساعة <b id="rainNext24">--</b></span><span>احتمال الهطول <b id="rainProbability">--</b></span><span>خلال 7 أيام <b id="rainNext7">--</b></span></div><p class="specialized-advice" id="rainAdvice">جارٍ تحليل الأمطار...</p></article>
</div></section>
<section class="map-section city-extra-section" id="maps"><div class="city-section-heading"><h2 class="city-section-title">خريطة الطقس التفاعلية</h2><button type="button" id="cityGps" class="city-refresh">تحديد موقعي عبر GPS</button></div><div class="map-controls city-map-controls"><button type="button" class="map-btn active" data-city-layer="temp_new">الحرارة</button><button type="button" class="map-btn" data-city-layer="precipitation_new">الأمطار</button><button type="button" class="map-btn" data-city-layer="wind_new">الرياح</button><button type="button" class="map-btn" data-city-layer="clouds_new">السحب</button></div><div id="cityWeatherMap" class="city-weather-map" role="application" aria-label="خريطة الطقس للمدينة"></div><p class="city-status" id="cityMapStatus">الخريطة تعرض طبقة الطقس فوق موقع المدينة.</p></section>
<section class="stats-section city-extra-section" id="stats"><h2 class="city-section-title">إحصائيات الطقس</h2><p class="stats-period-note">إحصائيات محسوبة من التوقعات المتاحة للأيام الخمسة القادمة.</p><div class="stats-grid city-stats-grid">
<article class="stat-card"><strong id="statMaxTemp">--</strong><span>أعلى حرارة</span></article><article class="stat-card"><strong id="statMinTemp">--</strong><span>أدنى حرارة</span></article><article class="stat-card"><strong id="statAvgTemp">--</strong><span>متوسط الحرارة</span></article><article class="stat-card"><strong id="statRain">--</strong><span>إجمالي الأمطار المتوقع</span></article><article class="stat-card"><strong id="statWind">--</strong><span>أقصى سرعة رياح</span></article><article class="stat-card"><strong id="statRainChance">--</strong><span>أعلى احتمال للأمطار</span></article>
</div></section>
<section class="tips-section city-extra-section"><div class="city-section-heading"><div><h2 class="city-section-title">نصائح الطقس الذكية</h2><p id="weatherTipsContext">نصائح تتغير وفق الطقس الحالي والتوقعات.</p></div><span id="weatherTipsStatus">جارٍ التحليل</span></div><div class="tips-grid" id="weatherTips" aria-live="polite"><p class="city-status">جارٍ إعداد النصائح...</p></div></section>
<section class="city-content"><article class="city-info-card"><h2 class="city-section-title">حالة الطقس والمناخ في ${escapeHtml(name)}</h2><p>تقع ${escapeHtml(name)} ضمن ${escapeHtml(group.region(city))} في ${escapeHtml(country)}. تساعدك هذه الصفحة على متابعة الطقس اليومي في المنطقة من خلال عرض درجة الحرارة، والحرارة المحسوسة، والرطوبة، وسرعة الرياح، والضغط الجوي، إضافة إلى توقعات الأيام المقبلة.</p><p>تتغير الظروف الجوية من يوم إلى آخر؛ لذلك يُنصح بمراجعة التحديثات قبل التنقل أو التخطيط للأنشطة الخارجية. تُعرض القيم الجوية عند توفرها من مزود البيانات، وقد تختلف دقة التوقعات بحسب الموقع والفترة الزمنية.</p></article>
<aside class="city-info-card"><h2 class="city-section-title">معلومات الموقع</h2><p><strong>المدينة:</strong> ${escapeHtml(name)}</p><p><strong>الدولة:</strong> ${escapeHtml(country)}</p><p><strong>المنطقة:</strong> ${escapeHtml(group.region(city))}</p>${group.parentName ? `<p><strong>الولاية:</strong> ${escapeHtml(group.parentName)}</p>` : ""}<p><strong>خط العرض:</strong> ${latitude.toFixed(4)}</p><p><strong>خط الطول:</strong> ${longitude.toFixed(4)}</p></aside></section>
<section class="city-related"><h2 class="city-section-title">مدن وولايات ذات صلة</h2><p class="city-status">انتقل مباشرة إلى صفحات الطقس الأخرى ضمن الدليل.</p><div class="city-related-links">${relatedLinks}</div><div class="city-related-links"><a href="${group.directoryPath || `${BASE}/weather/${group.key}/`}">${escapeHtml(group.directoryLinkLabel || "جميع " + group.title)}</a><a href="${BASE}/weather/">دليل الطقس الكامل</a><a href="${BASE}/">الصفحة الرئيسية</a></div></section>
</main>${adBlock("bottom")}${commonFooter()}
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" defer></script><script src="${BASE}/assets/js/specialized-weather.js" defer></script><script src="${BASE}/assets/js/city-page.js" defer></script></body></html>`;
}

const weatherRoot = join(ROOT, 'weather');
for (const group of groups) rmSync(join(weatherRoot, group.key), { recursive: true, force: true });
mkdirSync(weatherRoot, { recursive: true });
writePage('weather/index.html', `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>دليل الطقس في المدن والولايات | أحوال الطقس</title><meta name="description" content="اختر ولاية جزائرية أو عاصمة عربية أو مدينة عالمية للوصول إلى صفحة طقس مستقلة تشمل حالة الطقس الحالية وتوقعات خمسة أيام."><meta name="robots" content="index,follow"><link rel="canonical" href="${SITE}/weather/"><link rel="stylesheet" href="${BASE}/assets/css/style-main.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><link rel="stylesheet" href="${BASE}/assets/css/city-pages.css">${trackingTags()}<script type="application/ld+json">${safeJson(pageGraph({url: SITE + '/weather/', name: 'دليل الطقس في المدن والولايات | أحوال الطقس', description: 'اختر ولاية جزائرية أو عاصمة عربية أو مدينة عالمية للوصول إلى صفحة طقس مستقلة تشمل حالة الطقس الحالية وتوقعات خمسة أيام.', dateModified: TODAY, breadcrumbs: [{name:'الرئيسية',url:SITE+'/'},{name:'دليل الطقس',url:SITE+'/weather/'}]}))}</script></head><body class="city-page">${commonHeader()}${adBlock("top")}<main class="city-container city-directory"><nav class="city-breadcrumb" aria-label="مسار التنقل"><a href="${BASE}/">الرئيسية</a> / دليل الطقس</nav><header class="directory-hero"><div class="directory-hero-content"><span class="city-kicker">دليل المدن والطقس</span><h1 class="city-title">الطقس في الجزائر والعالم</h1><p class="city-directory-intro">تصفح أدلة الطقس للولايات الجزائرية والعواصم العربية والمدن العالمية، وانتقل إلى صفحات مستقلة تعرض حالة الطقس والتوقعات المحلية.</p><span class="directory-count">3 أدلة رئيسية لاستكشاف المدن</span></div><figure class="directory-hero-media"><img src="${BASE}/images/world-cities2.jpg?v=20261115" alt="رسم دلالي لمدن العالم ومعالمها العمرانية" width="960" height="620" loading="eager" fetchpriority="high" decoding="async"></figure></header><div class="city-directory-grid directory-feature-grid"><a class="city-directory-item directory-feature-card" href="${BASE}/weather/algeria/"><img class="directory-city-image" src="${BASE}/images/algiers.jpg" alt="منظر مدينة الجزائر العاصمة" width="640" height="360" loading="lazy" decoding="async"><span class="directory-city-body"><strong>ولايات الجزائر الـ69</strong><small class="directory-country">حالة الطقس في الولايات الجزائرية</small></span></a><a class="city-directory-item directory-feature-card" href="${BASE}/weather/arab/"><img class="directory-city-image" src="${BASE}/images/amman.jpg" alt="مشهد عمراني من عمّان يمثل العواصم العربية" width="640" height="360" loading="lazy" decoding="async"><span class="directory-city-body"><strong>العواصم العربية</strong><small class="directory-country">طقس العواصم والمدن العربية</small></span></a><a class="city-directory-item directory-feature-card" href="${BASE}/weather/world/"><img class="directory-city-image" src="${BASE}/images/world-cities2.jpg?v=20261115" alt="رسم لمدن عالمية ومعالم عمرانية" width="640" height="360" loading="lazy" decoding="async"><span class="directory-city-body"><strong>المدن والعواصم العالمية</strong><small class="directory-country">توقعات الطقس للمدن العالمية</small></span></a></div></main>${adBlock("bottom")}${commonFooter()}</body></html>`);

writePage('data/global-search-index.json', JSON.stringify(buildGlobalSearchIndex(), null, 2) + '\n');
writePage('sitemap.html', buildSitemapPage());

const sitemapUrls = [`${SITE}/`, `${SITE}/weather/`, `${SITE}/sitemap.html`];
for (const group of groups) {
  writePage(`weather/${group.key}/index.html`, buildDirectory(group));
  sitemapUrls.push(`${SITE}/weather/${group.key}/`);
  for (let index = 0; index < group.items.length; index++) {
    const city = group.items[index];
    if (group.items.findIndex(item => item.slug === city.slug) !== index) throw new Error(`Duplicate slug ${city.slug} in ${group.key}`);
    writePage(`weather/${group.key}/${city.slug}/index.html`, buildCityPage(group, index));
    sitemapUrls.push(pageUrl(group.key, city.slug));
  }
}
// Generate one representative commune page only during the pilot phase.
const communeAudit = auditCommuneSource();
const pilotSource = communeAudit.communes.find(commune => String(commune.id) === '1');
if (!pilotSource) throw new Error('Pilot commune id=1 (Adrar) is missing from data/communes.json');
const pilotWilaya = communeAudit.wilayaById.get(String(Number(pilotSource.wilaya_id)));
const pilotCommune = buildCommuneWeatherRecord(pilotSource, pilotWilaya);
const pilotGroup = {
  key: 'algeria',
  title: 'ولاية ' + pilotWilaya.name,
  kind: 'بلدية جزائرية',
  pageKindLabel: 'بلدية',
  parentName: pilotWilaya.name,
  robotsDirective: 'noindex,follow',
  directoryLinkLabel: 'صفحة ولاية ' + pilotWilaya.name,
  items: [pilotCommune],
  name: commune => commune.name,
  country: () => 'الجزائر',
  region: commune => commune.region,
  lat: commune => commune.latitude,
  lon: commune => commune.longitude,
  directoryUrl: SITE + '/weather/algeria/' + pilotWilaya.slug + '/',
  directoryPath: BASE + '/weather/algeria/' + pilotWilaya.slug + '/',
  pageUrl: commune => SITE + '/weather/algeria/communes/' + pilotWilaya.slug + '/' + commune.slug + '/',
  pagePath: commune => BASE + '/weather/algeria/communes/' + pilotWilaya.slug + '/' + commune.slug + '/'
};
writePage('weather/algeria/communes/' + pilotWilaya.slug + '/' + pilotCommune.slug + '/index.html', buildCityPage(pilotGroup, 0));
console.log('Commune source audit:', JSON.stringify({
  total: communeAudit.total,
  wilayas: communeAudit.wilayas,
  uniqueIds: communeAudit.uniqueIds,
  standardCoordinates: communeAudit.standardCoordinates,
  swappedCoordinates: communeAudit.swappedCoordinates,
  blankArabicNames: communeAudit.blankArabicNames,
  duplicateSlugGroups: communeAudit.duplicateSlugGroups,
  duplicateCoordinateGroups: communeAudit.duplicateCoordinateGroups
}));
const uniqueUrls = [...new Set(sitemapUrls)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uniqueUrls.map(url => `  <url><loc>${url}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}\n</urlset>\n`;
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');
console.log(`Generated ${groups.reduce((sum, group) => sum + group.items.length, 0)} city pages, ${groups.length} directories and sitemap (${uniqueUrls.length} URLs).`);
if (missingImages.length) console.warn(`Image fallback used for ${missingImages.length} cities: ${missingImages.slice(0, 20).map(item => item.slug + ' (' + item.expected + ')').join(', ')}`);
