import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DIR = join(ROOT, 'images');
const QUALITY = 78;
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 1200;
const CONCURRENCY = 3;

function walk(directory, predicate) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path, predicate) : predicate(path) ? [path] : [];
  });
}

const sources = walk(IMAGE_DIR, path => /\.(jpe?g)$/i.test(path));
let cursor = 0;
let converted = 0;
let originalBytes = 0;
let optimizedBytes = 0;

async function worker() {
  while (cursor < sources.length) {
    const source = sources[cursor++];
    const output = source.replace(/\.(jpe?g)$/i, '.webp');
    const sourceStat = statSync(source);
    if (existsSync(output) && statSync(output).mtimeMs >= sourceStat.mtimeMs) {
      optimizedBytes += statSync(output).size;
      originalBytes += sourceStat.size;
      continue;
    }
    mkdirSync(dirname(output), { recursive: true });
    await sharp(source)
      .rotate()
      .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 5, smartSubsample: true })
      .toFile(output);
    const outputBytes = statSync(output).size;
    originalBytes += sourceStat.size;
    if (outputBytes >= sourceStat.size) {
      unlinkSync(output);
      optimizedBytes += sourceStat.size;
      continue;
    }
    converted++;
    optimizedBytes += outputBytes;
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker));

const htmlFiles = [join(ROOT, 'index.html'), join(ROOT, 'sitemap.html'), ...walk(join(ROOT, 'weather'), path => extname(path).toLowerCase() === '.html')].filter(existsSync);
let rewrittenReferences = 0;
const imageReference = /(^|[\"'(=\s])((?:https?:\/\/imadtbn\.github\.io)?(?:\/today-weather)?\/?images\/[^\"'?#\s)]+)\.(jpe?g)(?=[?#\"'\s)]|$)/gi;

for (const file of htmlFiles) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(imageReference, (match, boundary, imagePath) => {
    const localPath = imagePath.replace(/^https?:\/\/imadtbn\.github\.io/, '')
      .replace(/^\/?today-weather\//, '').replace(/^\//, '');
    const webpPath = join(ROOT, localPath + '.webp');
    if (!existsSync(webpPath)) return match;
    rewrittenReferences++;
    return boundary + imagePath + '.webp';
  });
  if (after !== before) writeFileSync(file, after, 'utf8');
}

const savedBytes = Math.max(0, originalBytes - optimizedBytes);
const savedPercent = originalBytes ? ((savedBytes / originalBytes) * 100).toFixed(1) : '0.0';
console.log(JSON.stringify({
  sourceImages: sources.length,
  convertedThisRun: converted,
  htmlFilesScanned: htmlFiles.length,
  imageReferencesRewritten: rewrittenReferences,
  originalBytes,
  optimizedBytes,
  savedBytes,
  savedPercent: savedPercent + '%',
  format: 'WebP',
  quality: QUALITY
}, null, 2));
