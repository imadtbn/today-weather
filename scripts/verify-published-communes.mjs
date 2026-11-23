import { auditCommuneSource, buildCommuneWeatherRecord } from './communes-data.mjs';

const base = String(process.env.PAGES_URL || '').replace(/\\/$/, '');
const buildSha = process.env.GITHUB_SHA || 'local-check';
if (!/^https?:\\/\\//.test(base)) {
  throw new Error('PAGES_URL must contain the published GitHub Pages base URL');
}

const audit = auditCommuneSource();
const records = audit.communes.map(source => {
  const wilaya = audit.wilayaById.get(String(Number(source.wilaya_id)));
  if (!wilaya) throw new Error('Unknown wilaya for commune ' + source.id);
  return {
    ...buildCommuneWeatherRecord(source, wilaya),
    wilayaId: String(Number(source.wilaya_id)),
    wilaya
  };
});

const slugCounts = new Map();
for (const item of records) {
  const key = item.wilayaId + '/' + item.slug;
  slugCounts.set(key, (slugCounts.get(key) || 0) + 1);
}
for (const item of records) {
  if (slugCounts.get(item.wilayaId + '/' + item.slug) > 1) item.slug += '-' + item.id;
}

const targets = records.map(item => ({
  name: item.name,
  path: '/weather/algeria/communes/' + item.wilaya.slug + '/' + encodeURIComponent(item.slug) + '/',
  url: base + '/weather/algeria/communes/' + item.wilaya.slug + '/' +
    encodeURIComponent(item.slug) + '/?verify=' + buildSha
}));

const concurrency = 12;
let cursor = 0;
const failures = [];
let checked = 0;

async function verifyTarget(target) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(target.url, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status >= 500 && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          continue;
        }
        throw new Error('HTTP ' + response.status);
      }
      const contentType = response.headers.get('content-type') || '';
      await response.body?.cancel();
      if (!contentType.toLowerCase().includes('text/html')) {
        throw new Error('Unexpected content-type: ' + (contentType || 'missing'));
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3 && !String(error.message).startsWith('HTTP 404')) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        continue;
      }
      break;
    }
  }
  failures.push({ path: target.path, error: lastError?.message || 'Unknown error' });
}

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= targets.length) return;
    await verifyTarget(targets[index]);
    checked++;
    if (checked % 100 === 0 || checked === targets.length) {
      console.log('Published commune pages checked: ' + checked + '/' + targets.length);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const ainBerda = failures.find(item => item.path.endsWith('/annaba/ain-berda/'));
if (failures.length) {
  console.error('Published commune page verification failures (' + failures.length + '):');
  for (const failure of failures.slice(0, 100)) {
    console.error(failure.path + ' — ' + failure.error);
  }
  if (failures.length > 100) console.error('Additional failures: ' + (failures.length - 100));
  if (ainBerda) console.error('Critical: Ain Berda page is not reachable.');
  process.exitCode = 1;
} else {
  console.log('All ' + targets.length + ' published commune pages returned HTTP 200 with text/html.');
  console.log('Ain Berda verified: ' + base + '/weather/algeria/communes/annaba/ain-berda/');
}
