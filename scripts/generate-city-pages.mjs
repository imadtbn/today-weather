import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-PTCXG7CG"><\/script>' +
    '<script>window.dataLayer = window.dataLayer || []; function gtag() { dataLayer.push(arguments); } gtag("js", new Date());<\/script>' +
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5656416032906373" crossorigin="anonymous"><\/script>';
}
function commonHeader() {
  let header = homeSection('header')
    .replace(/src="assets\//g, 'src="' + BASE + '/assets/')
    .replace(/href="#"/g, 'href="' + BASE + '/"')
    .replace(/href="#([^"]+)"/g, 'href="' + BASE + '/#$1"')
    .replace('class="nav-link active"', 'class="nav-link"');
  return header;
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
  footer = footer.replace(/href="#"/g, 'href="' + BASE + '/"')
    .replace(/href="#([^"]+)"/g, 'href="' + BASE + '/#$1"');
  const searchIndex = groups.flatMap(group => group.items.map(city => ({
    group: group.key, slug: city.slug, name: group.name(city),
    latin: city.name_en || city.name_fr || '', country: group.country(city)
  })));
  return footer +
    '<script defer src="' + BASE + '/assets/js/adsData.js"><\/script>' +
    '<script>(function(){' +
    'var menu=document.getElementById("mobileMenuBtn"),nav=document.getElementById("mainNav");' +
    'if(menu&&nav){menu.addEventListener("click",function(){var open=nav.classList.toggle("active");menu.setAttribute("aria-expanded",String(open));menu.setAttribute("aria-label",open?"إغلاق قائمة التنقل":"فتح قائمة التنقل");});' +
    'nav.querySelectorAll("a").forEach(function(a){a.addEventListener("click",function(){nav.classList.remove("active");menu.setAttribute("aria-expanded","false");});});' +
    'document.addEventListener("keydown",function(e){if(e.key==="Escape"){nav.classList.remove("active");menu.setAttribute("aria-expanded","false");}});}' +
    'var locationButton=document.getElementById("locationBtn");if(locationButton)locationButton.addEventListener("click",function(){location.href="' + BASE + '/#home";});' +
    'var input=document.getElementById("searchInput"),suggestions=document.getElementById("citySuggestions"),cities=' + safeJson(searchIndex) + ';' +
    'if(input&&suggestions){var results=[];function render(){var q=input.value.trim().toLocaleLowerCase();results=q.length<2?[]:cities.filter(function(c){return (c.name+" "+c.latin+" "+c.country).toLocaleLowerCase().includes(q);}).slice(0,8);' +
    'suggestions.innerHTML=results.map(function(c,i){return \'<button type="button" class="city-suggestion-item" role="option" data-index="\' + i + \'"><span class="city-name">\' + c.name + \'</span><span class="city-region">\' + c.country + \'</span></button>\';}).join("");' +
    'suggestions.classList.toggle("visible",results.length>0);input.setAttribute("aria-expanded",String(results.length>0));}' +
    'function go(i){var c=results[i];if(c)location.href="' + BASE + '/weather/"+c.group+"/"+encodeURIComponent(c.slug)+"/";}' +
    'input.addEventListener("input",render);input.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();go(0);}else if(e.key==="Escape"){suggestions.classList.remove("visible");input.setAttribute("aria-expanded","false");}});' +
    'suggestions.addEventListener("click",function(e){var item=e.target.closest("[data-index]");if(item)go(Number(item.dataset.index));});' +
    'document.addEventListener("click",function(e){if(!e.target.closest(".search-wrapper"))suggestions.classList.remove("visible");});}' +
    '})();<\/script>';
}

function adBlock(position) {
  const unit = position === 'top'
    ? '<ins class="adsbygoogle" style="display:block" data-ad-format="fluid" data-ad-layout-key="-fr+56+4k-d4+74" data-ad-client="ca-pub-5656416032906373" data-ad-slot="7867079394"></ins>'
    : '<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-5656416032906373" data-ad-slot="3143411927" data-ad-format="auto" data-full-width-responsive="true"></ins>';
  return '<div class="container city-ad-wrap"><div class="ad-container"><span class="ad-label">إعلان</span><div class="ad-placeholder">' + unit + '</div></div></div>';
}

function buildDirectory(group) {
  const links = group.items.map(city => {
    const image = imagePath(city);
    const englishName = city.englishName || city.name_en || city.name_fr || '';
    const worldCountry = groups.find(item => item.key === 'world')?.items.find(item => item.countryCode === city.countryCode);
    const continent = city.continentName || city.continent || worldCountry?.continentName || (group.key === 'algeria' ? 'إفريقيا' : '');
    const phone = city.countryPhone || '';
    const code = city.countryCode || '';
    const subtitle = [group.country(city), continent].filter(Boolean).join(' · ');
    return `<a class="city-directory-item" href="${BASE}/weather/${group.key}/${encodeURIComponent(city.slug)}/"
      data-country-code="${escapeHtml(code)}" data-country-phone="${escapeHtml(phone)}"
      data-english-name="${escapeHtml(englishName)}" data-continent="${escapeHtml(continent)}">
      <img class="directory-city-image" src="${image}" alt="${escapeHtml('صورة ' + group.name(city) + ' - ' + group.country(city))}"
        width="640" height="400" loading="lazy" decoding="async">
      <span class="directory-city-body"><strong>${escapeHtml(group.name(city))}</strong>
      <small class="directory-country">${escapeHtml(subtitle)}</small>
      <span class="directory-city-meta"><span><bdi>${escapeHtml(code || '—')}</bdi></span>
      <span><bdi>${escapeHtml(phone || '—')}</bdi></span>
      <span lang="en" dir="ltr">${escapeHtml(englishName || '')}</span></span></span></a>`;
  }).join('\\n');
  const url = `${SITE}/weather/${group.key}/`;
  const schema = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: `الطقس في ${group.title}`, description: group.description, url, inLanguage: 'ar',
    mainEntity: { '@type': 'ItemList', numberOfItems: group.items.length,
      itemListElement: group.items.map((city, index) => ({
        '@type': 'ListItem', position: index + 1, name: group.name(city),
        url: pageUrl(group.key, city.slug)
      }))
    }
  };
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>الطقس في ${escapeHtml(group.title)} | أحوال الطقس</title><meta name="description" content="${escapeHtml(group.description)}"><meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:locale" content="ar_DZ"><meta property="og:title" content="الطقس في ${escapeHtml(group.title)}"><meta property="og:description" content="${escapeHtml(group.description)}"><meta property="og:url" content="${url}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap"><link rel="stylesheet" href="${BASE}/assets/css/style-main.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><link rel="stylesheet" href="${BASE}/assets/css/city-pages.css">${trackingTags()}<script type="application/ld+json">${safeJson(schema)}</script></head>
<body class="city-page">${commonHeader()}${adBlock("top")}
<main class="city-container city-directory"><nav class="city-breadcrumb"><a href="${BASE}/">الرئيسية</a> / <a href="${BASE}/weather/">دليل الطقس</a> / ${escapeHtml(group.title)}</nav>
<header class="directory-hero"><span class="city-kicker">دليل الطقس · ${escapeHtml(group.kind)}</span><h1 class="city-title">${escapeHtml(group.title)}</h1><p class="city-directory-intro">${escapeHtml(group.description)}</p><span class="directory-count">استكشف ${group.items.length} مدينة</span></header>
<div class="city-directory-grid">${links}</div></main>
${adBlock("bottom")}${commonFooter()}
<script>(function(){var grid=document.querySelector('.city-directory-grid');if(!grid)return;var cards=Array.from(grid.children);grid.classList.add('directory-progressive');if(!('IntersectionObserver'in window)){cards.forEach(function(card){card.classList.add('is-visible');});return;}var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}});},{rootMargin:'180px 0px',threshold:0.01});cards.forEach(function(card){observer.observe(card);});})();<\\/script>
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
  const url = pageUrl(group.key, city.slug);
  const image = imagePath(city);
  const title = `طقس ${name} اليوم | حالة الطقس وتوقعات 5 أيام`;
  const description = `تعرف على طقس ${name} في ${country}: درجات الحرارة الحالية، الحالة الجوية، الرطوبة والرياح، وتوقعات الطقس لمدة خمسة أيام حسب الإحداثيات المحلية.`;
  const related = Array.from({ length: Math.min(8, group.items.length - 1) }, (_, offset) =>
    group.items[(index + offset + 1) % group.items.length]
  ).filter(item => item.slug !== city.slug);
  const relatedLinks = related.map(item =>
    `<a href="${BASE}/weather/${group.key}/${encodeURIComponent(item.slug)}/">${escapeHtml(group.name(item))}</a>`
  ).join('');
  const breadcrumb = [
    { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'دليل الطقس', item: `${SITE}/weather/` },
    { '@type': 'ListItem', position: 3, name: group.title, item: `${SITE}/weather/${group.key}/` },
    { '@type': 'ListItem', position: 4, name, item: url }
  ];
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': url + '#webpage', url, name: title, description,
        inLanguage: 'ar', dateModified: TODAY,
        primaryImageOfPage: { '@type': 'ImageObject', url: SITE + image } },
      { '@type': 'Place', '@id': url + '#place', name,
        containedInPlace: { '@type': 'Country', name: country },
        geo: { '@type': 'GeoCoordinates', latitude, longitude } },
      { '@type': 'BreadcrumbList', itemListElement: breadcrumb }
    ]
  };
  const config = safeJson({ lat: latitude, lon: longitude, name, country, countryCode: city.countryCode || city.country_code || (group.key === 'algeria' ? 'DZ' : '') });
  const imageAlt = `صورة ${name} في ${country}`;
  const groupLabel = group.key === 'algeria' ? 'الولايات الجزائرية' : group.key === 'arab' ? 'العواصم العربية' : 'المدن العالمية';
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<link rel="canonical" href="${url}"><meta name="theme-color" content="#0a0e1a">
<meta property="og:type" content="website"><meta property="og:locale" content="ar_DZ"><meta property="og:site_name" content="أحوال الطقس"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE + image}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${SITE + image}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><link rel="stylesheet" href="${BASE}/assets/css/style-main.css"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><link rel="stylesheet" href="${BASE}/assets/css/city-pages.css">
${trackingTags()}<script type="application/ld+json">${safeJson(schema)}</script></head>
<body class="city-page">${commonHeader()}${adBlock("top")}
<main class="city-container" data-city-weather='${escapeHtml(config)}'>
<nav class="city-breadcrumb" aria-label="مسار التنقل"><a href="${BASE}/">الرئيسية</a> / <a href="${BASE}/weather/">دليل الطقس</a> / <a href="${BASE}/weather/${group.key}/">${groupLabel}</a> / ${escapeHtml(name)}</nav>
<section class="city-hero"><div class="city-hero-grid"><div><span class="city-kicker">${escapeHtml(group.kind)} · ${escapeHtml(country)}</span><h1 class="city-title">طقس ${escapeHtml(name)} اليوم</h1><p class="city-subtitle">تابع حالة الطقس في ${escapeHtml(name)}، ${escapeHtml(country)}، واطلع على درجات الحرارة الحالية وتوقعات الأيام الخمسة القادمة. تعتمد بيانات هذه الصفحة على الإحداثيات الجغرافية للمدينة (${latitude.toFixed(4)}، ${longitude.toFixed(4)}) لعرض معلومات جوية مرتبطة بموقعها.</p></div>
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
<aside class="city-info-card"><h2 class="city-section-title">معلومات الموقع</h2><p><strong>المدينة:</strong> ${escapeHtml(name)}</p><p><strong>الدولة:</strong> ${escapeHtml(country)}</p><p><strong>المنطقة:</strong> ${escapeHtml(group.region(city))}</p><p><strong>خط العرض:</strong> ${latitude.toFixed(4)}</p><p><strong>خط الطول:</strong> ${longitude.toFixed(4)}</p></aside></section>
<section class="city-related"><h2 class="city-section-title">مدن وولايات ذات صلة</h2><p class="city-status">انتقل مباشرة إلى صفحات الطقس الأخرى ضمن الدليل.</p><div class="city-related-links">${relatedLinks}</div><div class="city-related-links"><a href="${BASE}/weather/${group.key}/">جميع ${groupLabel}</a><a href="${BASE}/weather/">دليل الطقس الكامل</a><a href="${BASE}/">الصفحة الرئيسية</a></div></section>
</main>${adBlock("bottom")}${commonFooter()}
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" defer></script><script src="${BASE}/assets/js/specialized-weather.js" defer></script><script src="${BASE}/assets/js/city-page.js" defer></script></body></html>`;
}

const weatherRoot = join(ROOT, 'weather');
for (const group of groups) rmSync(join(weatherRoot, group.key), { recursive: true, force: true });
mkdirSync(weatherRoot, { recursive: true });
writePage('weather/index.html', `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>دليل الطقس في المدن والولايات | أحوال الطقس</title><meta name="description" content="اختر ولاية جزائرية أو عاصمة عربية أو مدينة عالمية للوصول إلى صفحة طقس مستقلة تشمل حالة الطقس الحالية وتوقعات خمسة أيام."><meta name="robots" content="index,follow"><link rel="canonical" href="${SITE}/weather/"><link rel="stylesheet" href="${BASE}/assets/css/style-main.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><link rel="stylesheet" href="${BASE}/assets/css/city-pages.css">${trackingTags()}</head><body class="city-page">${commonHeader()}${adBlock("top")}<main class="city-container city-directory"><span class="city-kicker">دليل المدن</span><h1 class="city-title">الطقس في الجزائر والعالم</h1><p class="city-directory-intro">تصفح صفحات الطقس المستقلة للولايات الجزائرية والعواصم العربية والمدن العالمية. تتضمن كل صفحة حالة الطقس الحالية والتوقعات اليومية وفق إحداثيات المدينة، إلى جانب معلوماتها وروابط المدن الأخرى.</p><div class="city-directory-grid"><a class="city-directory-item" href="${BASE}/weather/algeria/"><strong>ولايات الجزائر الـ69</strong><small>حالة الطقس في الولايات الجزائرية</small></a><a class="city-directory-item" href="${BASE}/weather/arab/"><strong>العواصم العربية</strong><small>طقس العواصم والمدن العربية</small></a><a class="city-directory-item" href="${BASE}/weather/world/"><strong>مدن العالم</strong><small>توقعات الطقس للمدن العالمية</small></a></div></main>${adBlock("bottom")}${commonFooter()}</body></html>`);

const sitemapUrls = [`${SITE}/`, `${SITE}/weather/`];
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
const uniqueUrls = [...new Set(sitemapUrls)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uniqueUrls.map(url => `  <url><loc>${url}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}\n</urlset>\n`;
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');
console.log(`Generated ${groups.reduce((sum, group) => sum + group.items.length, 0)} city pages, ${groups.length} directories and sitemap (${uniqueUrls.length} URLs).`);
if (missingImages.length) console.warn(`Image fallback used for ${missingImages.length} cities: ${missingImages.slice(0, 20).map(item => item.slug + ' (' + item.expected + ')').join(', ')}`);
