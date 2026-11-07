const DEFAULT_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OVERPASS_URLS = (process.env.EXPO_PUBLIC_OVERPASS_URLS || DEFAULT_OVERPASS_URLS.join(','))
  .split(',').map((url) => url.trim()).filter(Boolean);
const NOMINATIM_URL = (process.env.EXPO_PUBLIC_NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const RADII_M = [5000, 15000, 40000];
const QUERY_KIND = {
  hospital: 'nwr["amenity"="hospital"]',
  police: 'nwr["amenity"="police"]',
  fire: 'nwr["amenity"="fire_station"]',
};

export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function timedFetch(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function overpass(lat, lng, radius) {
  const clauses = Object.values(QUERY_KIND).map((selector) => `${selector}(around:${radius},${lat},${lng});`).join('');
  const query = `[out:json][timeout:20];(${clauses});out center 80;`;
  let lastError;
  for (const url of OVERPASS_URLS) {
    try {
      const response = await timedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
      }, 22000);
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      const data = await response.json();
      return data.elements || [];
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`OpenStreetMap place lookup failed${lastError ? `: ${lastError.message}` : ''}`);
}

function kindFor(tags = {}) {
  if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') return 'hospital';
  if (tags.amenity === 'police') return 'police';
  if (tags.amenity === 'fire_station') return 'fire';
  return null;
}

function makePlace(origin, kind, id, name, lat, lng, source = 'OpenStreetMap') {
  return {
    id,
    kind,
    name: name || ({ hospital: 'Hospital', police: 'Police station', fire: 'Fire station' }[kind] || 'Emergency service'),
    lat,
    lng,
    distanceKm: haversineKm(origin, { lat, lng }),
    source,
  };
}

function parseOverpass(origin, elements) {
  return elements.map((element) => {
    const kind = kindFor(element.tags);
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (!kind || lat == null || lng == null) return null;
    return makePlace(origin, kind, `${element.type}-${element.id}`, element.tags?.name, lat, lng);
  }).filter(Boolean);
}

async function nominatimSearch(origin, kind, radiusKm) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / Math.max(10, 111 * Math.cos((origin.lat * Math.PI) / 180));
  const viewbox = [origin.lng - dLng, origin.lat + dLat, origin.lng + dLng, origin.lat - dLat].join(',');
  const params = new URLSearchParams({ format: 'jsonv2', limit: '15', bounded: '1', viewbox, q: ({ hospital: 'hospital', police: 'police station', fire: 'fire station' })[kind] });
  const response = await timedFetch(`${NOMINATIM_URL}/search?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const results = await response.json();
  return results.map((result) => makePlace(origin, kind, `nom-${result.place_id}`, result.name || result.display_name?.split(',')[0], Number(result.lat), Number(result.lon), 'Nominatim'))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

export async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const params = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: '18', addressdetails: '1' });
  const response = await timedFetch(`${NOMINATIM_URL}/reverse?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = await response.json();
  const address = data.address || {};
  const generalArea = [address.suburb, address.city_district, address.city, address.town, address.village, address.county, address.state]
    .find((part) => typeof part === 'string' && part.trim()) || '';
  return { address: data.display_name || '', generalArea };
}

export async function findNearbyHelp(lat, lng) {
  const origin = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng) || origin.lat < -90 || origin.lat > 90 || origin.lng < -180 || origin.lng > 180) {
    throw new Error('A valid location is required to find nearby help.');
  }
  const results = { hospital: [], police: [], fire: [] };
  let overpassError = null;
  try {
    for (const radius of RADII_M) {
      const places = parseOverpass(origin, await overpass(origin.lat, origin.lng, radius));
      for (const place of places) {
        if (!results[place.kind].some((existing) => existing.id === place.id)) results[place.kind].push(place);
      }
      if (Object.values(results).every((list) => list.length > 0)) break;
    }
  } catch (error) {
    overpassError = error;
  }
  const missingKinds = Object.keys(results).filter((kind) => results[kind].length === 0);
  for (const kind of missingKinds) {
    for (const radius of RADII_M) {
      try {
        const places = await nominatimSearch(origin, kind, radius / 1000);
        results[kind].push(...places);
        if (places.length) break;
      } catch (error) {
        if (!overpassError) overpassError = error;
      }
    }
  }
  for (const kind of Object.keys(results)) results[kind].sort((a, b) => a.distanceKm - b.distanceKm);
  const found = Object.values(results).some((list) => list.length > 0);
  if (!found && overpassError) throw new Error(`Nearby help lookup is temporarily unavailable. ${overpassError.message}`);
  return results;
}

export function relevantHelpKind(category) {
  if (category === 'Medical') return 'hospital';
  if (category === 'Fire' || category === 'Natural hazard') return 'fire';
  if (category === 'Crime/Safety' || category === 'Harassment') return 'police';
  return null;
}

export function nearestHelp(results, category) {
  const kind = relevantHelpKind(category);
  if (kind && results?.[kind]?.[0]) return results[kind][0];
  return Object.values(results || {}).flat().sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;
}

// Backward-compatible hospital-only helpers used by earlier screen versions.
export async function findNearby(lat, lng) {
  const results = await findNearbyHelp(lat, lng);
  return results.hospital || [];
}

export function pickNearest(places) {
  return places[0] || null;
}

export async function geocodeAddress(address) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', q: address });
  const response = await timedFetch(`${NOMINATIM_URL}/search?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const results = await response.json();
  if (!results.length) return null;
  return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
}
