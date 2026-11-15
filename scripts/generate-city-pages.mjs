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


function trackingTags() {
  return '<meta name="google-site-verification" content="f5Xi4oFx0v5dN6iPZd9qCw-7vnc3vIbAeYF9jr4vwVM"><meta name="msvalidate.01" content="9BCA38377A234DCCEB9991EAD1A2F6C2">' +
    '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-PTCXG7CG"><\/script>' +
    '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());<\/script>' +
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5656416032906373" crossorigin="anonymous"><\/script>';
}
function commonHeader() {
  return '<header class="site-header" id="siteHeader"><div class="header-inner">' +
    '<a href="' + BASE + '/" class="brand"><img src="' + BASE + '/assets/images/icon1.webp" alt="أحوال الطقس" class="brand-icon"><div class="brand-text"><span class="brand-name">أحوال الطقس</span><span class="brand-tagline">توقعات طقس محدثة</span></div></a>' +
    '<button class="mobile-menu-btn" id="mobileMenuBtn" type="button" aria-label="فتح قائمة التنقل" aria-controls="mainNav" aria-expanded="false"><i class="fas fa-bars" aria-hidden="true"></i></button>' +
    '<nav class="main-nav" id="mainNav" aria-label="التنقل الرئيسي"><ul class="nav-list">' +
    '<li><a href="' + BASE + '/" class="nav-link">الرئيسية</a></li><li><a href="' + BASE + '/#forecast" class="nav-link">التنبؤات</a></li><li><a href="' + BASE + '/#maps" class="nav-link">الخرائط</a></li><li><a href="' + BASE + '/#stats" class="nav-link">الإحصائيات</a></li><li><a href="' + BASE + '/#warnings" class="nav-link">التحذيرات</a></li><li><a href="' + BASE + '/weather/" class="nav-link">دليل المدن</a></li>' +
    '</ul></nav><div class="header-controls"><a class="icon-btn" href="' + BASE + '/" aria-label="العودة إلى الصفحة الرئيسية"><i class="fas fa-house"></i></a></div></div></header>';
}
function adBlock(position) {
  const unit = position === 'top'
    ? '<ins class="adsbygoogle" style="display:block" data-ad-format="fluid" data-ad-layout-key="-fr+56+4k-d4+74" data-ad-client="ca-pub-5656416032906373" data-ad-slot="7867079394"></ins>'
    : '<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-5656416032906373" data-ad-slot="3143411927" data-ad-format="auto" data-full-width-responsive="true"></ins>';
  return '<div class="container city-ad-wrap"><div class="ad-container"><span class="ad-label">إعلان</span><div class="ad-placeholder">' + unit + '</div></div></div>';
}
function commonFooter() {
  const labels = ['الجزائر العاصمة','وهران','قسنطينة','عنابة','البليدة','سطيف'];
  const links = labels.map((label, i) => '<li><a href="' + BASE + '/weather/algeria/' + encodeURIComponent(groups[0].items[i].slug) + '/"><i class="fas fa-chevron-left"></i> ' + label + '</a></li>').join('');
  return '<footer class="site-footer" id="contact"><div class="container"><div class="footer-grid">' +
    '<div class="footer-brand"><a href="' + BASE + '/" class="brand"><img src="' + BASE + '/assets/images/icon1.webp" alt="أحوال الطقس" class="brand-icon"><div class="brand-text"><span class="brand-name">أحوال الطقس</span><span class="brand-tagline">توقعات طقس محدثة</span></div></a><p>منصة لمتابعة حالة الطقس اليوم وتوقعات الطقس في الجزائر والمدن العالمية، تشمل درجات الحرارة والأمطار والرياح والخرائط الجوية ومؤشرات الطقس المتخصصة.</p></div>' +
    '<div><h3 class="footer-title">روابط سريعة</h3><ul class="footer-links"><li><a href="' + BASE + '/"><i class="fas fa-chevron-left"></i> الرئيسية</a></li><li><a href="' + BASE + '/#forecast"><i class="fas fa-chevron-left"></i> التنبؤات</a></li><li><a href="' + BASE + '/#maps"><i class="fas fa-chevron-left"></i> الخرائط</a></li><li><a href="' + BASE + '/weather/"><i class="fas fa-chevron-left"></i> دليل المدن</a></li></ul></div>' +
    '<div><h3 class="footer-title">المدن الرئيسية</h3><ul class="footer-links">' + links + '</ul></div>' +
    '<div><h3 class="footer-title">معلومات التواصل</h3><div class="footer-contact-item"><i class="fas fa-map-marker-alt"></i><span>الجزائر العاصمة، الجزائر</span></div><div class="footer-contact-item"><i class="fas fa-phone"></i><a href="tel:+213697743721" dir="ltr">+213 697 743 721</a></div><div class="footer-contact-item"><i class="fas fa-envelope"></i><a href="mailto:tabaniimadeddine@gmail.com">tabaniimadeddine@gmail.com</a></div><div class="footer-contact-item"><i class="fas fa-globe"></i><a href="https://imadtbn.github.io/dz_portal/" target="_blank" rel="noopener noreferrer">البوابة الجزائرية</a></div></div>' +
    '</div><div class="footer-bottom"><div class="footer-copyright">© ' + new Date().getFullYear() + ' أحوال الطقس. جميع الحقوق محفوظة.</div><div class="footer-copyright">بيانات الطقس من <a href="https://openweathermap.org">OpenWeatherMap</a> | الخرائط عبر <a href="https://leafletjs.com">Leaflet</a> | البحث الجغرافي <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a></div></div></div></footer>' +
    '<script defer src="' + BASE + '/assets/js/adsData.js"><\/script><script>(function(){var b=document.getElementById("mobileMenuBtn"),n=document.getElementById("mainNav");if(b&&n){b.addEventListener("click",function(){var o=n.classList.toggle("active");b.setAttribute("aria-expanded",String(o));});n.querySelectorAll("a").forEach(function(a){a.addEventListener("click",function(){n.classList.remove("active");b.setAttribute("aria-expanded","false");});});}})();<\/script>';
}

function buildDirectory(group) {
  const links = group.items.map(city => `<a class="city-directory-item" href="${BASE}/weather/${group.key}/${encodeURIComponent(city.slug)}/"><strong>${escapeHtml(group.name(city))}</strong><small>${escapeHtml(group.country(city))}${city.region ? ' · ' + escapeHtml(city.region) : city.continentName ? ' · ' + escapeHtml(city.continentName) : ''}</small></a>`).join('\n');
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
<main class="city-container city-directory"><nav class="city-breadcrumb"><a href="${BASE}/">الرئيسية</a> / <a href="${BASE}/weather/">دليل الطقس</a> / ${escapeHtml(group.title)}</nav><span class="city-kicker">صفحات الطقس المستقلة</span><h1 class="city-title">${escapeHtml(group.title)}</h1><p class="city-directory-intro">${escapeHtml(group.description)} تضم هذه القائمة ${group.items.length} صفحة مدينة مرتبطة بإحداثياتها الجغرافية.</p><div class="city-directory-grid">${links}</div></main>
${adBlock("bottom")}${commonFooter()}</body></html>`;
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
  const config = safeJson({ lat: latitude, lon: longitude, name, country });
  const imageAlt = `صورة ${name} في ${country}`;
  const groupLabel = group.key === 'algeria' ? 'الولايات الجزائرية' : group.key === 'arab' ? 'العواصم العربية' : 'المدن العالمية';
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<link rel="canonical" href="${url}"><meta name="theme-color" content="#0a0e1a">
<meta property="og:type" content="website"><meta property="og:locale" content="ar_DZ"><meta property="og:site_name" content="أحوال الطقس"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE + image}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${SITE + image}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><link rel="stylesheet" href="${BASE}/assets/css/city-pages.css">
<script type="application/ld+json">${safeJson(schema)}</script></head>
<body class="city-page">${commonHeader()}${adBlock("top")}
<main class="city-container" data-city-weather='${escapeHtml(config)}'>
<nav class="city-breadcrumb" aria-label="مسار التنقل"><a href="${BASE}/">الرئيسية</a> / <a href="${BASE}/weather/">دليل الطقس</a> / <a href="${BASE}/weather/${group.key}/">${groupLabel}</a> / ${escapeHtml(name)}</nav>
<section class="city-hero"><div class="city-hero-grid"><div><span class="city-kicker">${escapeHtml(group.kind)} · ${escapeHtml(country)}</span><h1 class="city-title">طقس ${escapeHtml(name)} اليوم</h1><p class="city-subtitle">تابع حالة الطقس في ${escapeHtml(name)}، ${escapeHtml(country)}، واطلع على درجات الحرارة الحالية وتوقعات الأيام الخمسة القادمة. تعتمد بيانات هذه الصفحة على الإحداثيات الجغرافية للمدينة (${latitude.toFixed(4)}، ${longitude.toFixed(4)}) لعرض معلومات جوية مرتبطة بموقعها.</p></div>
<figure class="city-image-wrap"><img src="${image}" alt="${escapeHtml(imageAlt)}" width="960" height="600" fetchpriority="high" decoding="async"></figure></div></section>
<section class="city-weather" aria-labelledby="cityWeatherTitle"><div class="city-weather-card"><div class="city-weather-head"><h2 id="cityWeatherTitle">حالة الطقس الحالية في ${escapeHtml(name)}</h2><span class="city-live-label"><i class="fa-solid fa-circle" aria-hidden="true"></i> بيانات مباشرة</span></div>
<div class="city-current"><div><div class="city-temp" id="cityTemp" aria-live="polite">--°</div><p class="city-condition" id="cityCondition">جارٍ تحميل حالة الطقس...</p></div><i id="cityWeatherIcon" class="fa-solid fa-cloud city-weather-icon" aria-hidden="true"></i></div>
<div class="city-metrics"><div class="city-metric"><strong id="cityFeels">--</strong><span>الحرارة المحسوسة</span></div><div class="city-metric"><strong id="cityHumidity">--</strong><span>الرطوبة</span></div><div class="city-metric"><strong id="cityWind">--</strong><span>سرعة الرياح</span></div><div class="city-metric"><strong id="cityPressure">--</strong><span>الضغط الجوي</span></div></div>
<p class="city-status" id="cityStatus" role="status">يتم الاتصال بمصدر بيانات الطقس...</p><p class="city-status" id="cityUpdated"></p><button id="cityRefresh" type="button" class="city-refresh">تحديث الطقس</button></div>
<div class="city-forecast city-forecast-card"><h2 class="city-section-title">توقعات الطقس لمدة خمسة أيام في ${escapeHtml(name)}</h2><div class="city-forecast-grid" id="cityForecast"><p class="city-status">جارٍ تحميل التوقعات...</p></div></div></section>
<section class="city-content"><article class="city-info-card"><h2 class="city-section-title">حالة الطقس والمناخ في ${escapeHtml(name)}</h2><p>تقع ${escapeHtml(name)} ضمن ${escapeHtml(group.region(city))} في ${escapeHtml(country)}. تساعدك هذه الصفحة على متابعة الطقس اليومي في المنطقة من خلال عرض درجة الحرارة، والحرارة المحسوسة، والرطوبة، وسرعة الرياح، والضغط الجوي، إضافة إلى توقعات الأيام المقبلة.</p><p>تتغير الظروف الجوية من يوم إلى آخر؛ لذلك يُنصح بمراجعة التحديثات قبل التنقل أو التخطيط للأنشطة الخارجية. تُعرض القيم الجوية عند توفرها من مزود البيانات، وقد تختلف دقة التوقعات بحسب الموقع والفترة الزمنية.</p></article>
<aside class="city-info-card"><h2 class="city-section-title">معلومات الموقع</h2><p><strong>المدينة:</strong> ${escapeHtml(name)}</p><p><strong>الدولة:</strong> ${escapeHtml(country)}</p><p><strong>المنطقة:</strong> ${escapeHtml(group.region(city))}</p><p><strong>خط العرض:</strong> ${latitude.toFixed(4)}</p><p><strong>خط الطول:</strong> ${longitude.toFixed(4)}</p></aside></section>
<section class="city-related"><h2 class="city-section-title">مدن وولايات ذات صلة</h2><p class="city-status">انتقل مباشرة إلى صفحات الطقس الأخرى ضمن الدليل.</p><div class="city-related-links">${relatedLinks}</div><div class="city-related-links"><a href="${BASE}/weather/${group.key}/">جميع ${groupLabel}</a><a href="${BASE}/weather/">دليل الطقس الكامل</a><a href="${BASE}/">الصفحة الرئيسية</a></div></section>
</main>${adBlock("bottom")}${commonFooter()}
<script src="${BASE}/assets/js/city-page.js" defer></script></body></html>`;
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
