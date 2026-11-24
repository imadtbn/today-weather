import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'playwright-report', 'test-results']);

function walk(directory, predicate) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory() && SKIP.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path, predicate) : predicate(path) ? [path] : [];
  });
}

const cssFiles = walk(ROOT, path => extname(path).toLowerCase() === '.css');
const scriptFiles = walk(ROOT, path => /\.(?:js|mjs|cjs)$/i.test(path));
const jsonFiles = walk(ROOT, path => extname(path).toLowerCase() === '.json');
const htmlFiles = walk(ROOT, path => extname(path).toLowerCase() === '.html');
const imageFiles = walk(join(ROOT, 'images'), path => /\.(?:avif|gif|jpe?g|png|webp)$/i.test(path));

for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8');
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length,
    'Unbalanced CSS braces: ' + relative(ROOT, file));
}
for (const file of scriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'JavaScript syntax error in ' + relative(ROOT, file) + ': ' + (result.stderr || result.stdout));
}
for (const file of jsonFiles) {
  try { JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new Error('Invalid JSON in ' + relative(ROOT, file) + ': ' + error.message); }
}

function localResourcePath(raw, htmlFile) {
  let value = raw.split(/[?#]/, 1)[0];
  if (!value || /^(?:data:|blob:|mailto:|tel:|javascript:)/i.test(value)) return null;
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.hostname !== 'imadtbn.github.io') return null;
    value = url.pathname;
  }
  value = value.replace(/^\/?today-weather\//, '').replace(/^\//, '');
  if (!value) return null;
  return value.startsWith('images/') || value.startsWith('assets/') || value.startsWith('data/')
    ? resolve(ROOT, value)
    : resolve(dirname(htmlFile), value);
}

let imageReferences = 0;
let missingImages = [];
let resourceReferences = 0;
let missingResources = [];

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  for (const match of html.matchAll(/<img\b[^>]*\b(?:src|data-src)=["']([^"']+)["']/gi)) {
    const target = localResourcePath(match[1], file);
    if (!target) continue;
    imageReferences++;
    if (!existsSync(target) || !statSync(target).isFile()) missingImages.push(relative(ROOT, file) + ' -> ' + match[1]);
  }
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
    const raw = match[1];
    if (!/\.(?:css|js|mjs|json|webmanifest)(?:[?#]|$)/i.test(raw)) continue;
    const target = localResourcePath(raw, file);
    if (!target) continue;
    resourceReferences++;
    if (!existsSync(target) || !statSync(target).isFile()) missingResources.push(relative(ROOT, file) + ' -> ' + raw);
  }
}

for (const file of imageFiles) {
  assert.ok(statSync(file).size > 0, 'Empty image file: ' + relative(ROOT, file));
}
assert.deepEqual(missingImages, [], 'Missing local image references: ' + missingImages.slice(0, 20).join('; '));
assert.deepEqual(missingResources, [], 'Missing local CSS/JS/JSON references: ' + missingResources.slice(0, 20).join('; '));

console.log(JSON.stringify({
  htmlFiles: htmlFiles.length,
  cssFiles: cssFiles.length,
  javascriptFiles: scriptFiles.length,
  jsonFiles: jsonFiles.length,
  imageFiles: imageFiles.length,
  imageReferences,
  resourceReferences,
  result: 'passed'
}, null, 2));
