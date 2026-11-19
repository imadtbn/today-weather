import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8').replace(/^\uFEFF/, ''));

export function slugifyCommune(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[’'\u0060]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function insideAlgeria(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= 18 && latitude <= 38 && longitude >= -9 && longitude <= 12;
}

// The source has mixed coordinate-column conventions. Resolve each row using Algeria's geographic bounds.
export function resolveCommuneCoordinates(commune) {
  const sourceLatitude = Number(commune.latitude);
  const sourceLongitude = Number(commune.longitude);
  const normal = { latitude: sourceLatitude, longitude: sourceLongitude, orientation: 'standard' };
  const swapped = { latitude: sourceLongitude, longitude: sourceLatitude, orientation: 'swapped' };
  const normalValid = insideAlgeria(normal.latitude, normal.longitude);
  const swappedValid = insideAlgeria(swapped.latitude, swapped.longitude);
  if (normalValid === swappedValid) {
    throw new Error('Cannot resolve commune coordinates uniquely: ' + commune.id + ' (' + commune.name + ')');
  }
  return normalValid ? normal : swapped;
}

export function auditCommuneSource() {
  const communes = readJson('data/communes.json');
  const wilayas = readJson('data/cities.json');
  const wilayaById = new Map(wilayas.map(wilaya => [String(Number(wilaya.code)), wilaya]));
  const ids = new Set();
  const slugGroups = new Map();
  const coordinates = new Map();
  let standardCoordinates = 0;
  let swappedCoordinates = 0;
  let blankArabicNames = 0;

  for (const commune of communes) {
    const id = String(commune.id || '');
    if (!id || ids.has(id)) throw new Error('Missing or duplicate commune id: ' + id);
    ids.add(id);
    const wilayaId = String(Number(commune.wilaya_id));
    if (!wilayaById.has(wilayaId)) throw new Error('Unknown wilaya_id for commune ' + id + ': ' + wilayaId);
    const point = resolveCommuneCoordinates(commune);
    if (point.orientation === 'standard') standardCoordinates++;
    else swappedCoordinates++;
    if (!String(commune.ar_name || '').trim()) blankArabicNames++;
    const slug = slugifyCommune(commune.name);
    if (!slug) throw new Error('Cannot create URL slug for commune ' + id);
    const key = wilayaId + '/' + slug;
    slugGroups.set(key, (slugGroups.get(key) || 0) + 1);
    const coordinateKey = point.latitude.toFixed(5) + ',' + point.longitude.toFixed(5);
    coordinates.set(coordinateKey, (coordinates.get(coordinateKey) || 0) + 1);
  }

  return {
    total: communes.length,
    wilayas: wilayas.length,
    uniqueIds: ids.size,
    standardCoordinates,
    swappedCoordinates,
    blankArabicNames,
    duplicateSlugGroups: [...slugGroups.values()].filter(count => count > 1).length,
    duplicateCoordinateGroups: [...coordinates.values()].filter(count => count > 1).length,
    communes,
    wilayaById
  };
}

const ARABIC_COMMUNE_NAME_OVERRIDES = new Map([['Talmine', 'تالمين']]);

export function buildCommuneWeatherRecord(commune, wilaya) {
  const point = resolveCommuneCoordinates(commune);
  const arabicName = String(commune.ar_name || '').trim() || ARABIC_COMMUNE_NAME_OVERRIDES.get(commune.name) || commune.name;
  return {
    ...commune,
    slug: slugifyCommune(commune.name),
    name: arabicName,
    name_en: commune.name,
    name_fr: commune.name,
    latitude: point.latitude,
    longitude: point.longitude,
    countryCode: 'DZ',
    countryImages: wilaya.countryImages || '',
    region: wilaya.region || 'الجزائر'
  };
}
