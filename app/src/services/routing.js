// Routing adapter: override either base URL to replace OSRM with a compatible provider.
function straightLineKm(from, to) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function profileForDistance(from, to) {
  return straightLineKm(from, to) <= 5 ? 'foot' : 'driving';
}

export function getRouteForDistance(from, to) {
  const profile = profileForDistance(from, to);
  return getRoute(from, to, { profile }).then((route) => ({ ...route, profile }));
}

export async function getRoute(from, to, { profile = 'driving' } = {}) {
  if (!from || !to || !Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) {
    throw new Error('Valid start and destination coordinates are required.');
  }
  if (!['driving', 'foot'].includes(profile)) throw new Error('Choose a supported route profile.');
  const configuredBase = profile === 'foot'
    ? (process.env.EXPO_PUBLIC_OSRM_FOOT_URL || 'https://routing.openstreetmap.de/routed-foot')
    : (process.env.EXPO_PUBLIC_OSRM_DRIVING_URL || 'https://router.project-osrm.org');
  const base = configuredBase.replace(/\/$/, '');
  const url =
    `${base}/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}` +
    '?overview=full&geometries=geojson';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const json = await res.json();
    const best = json.routes && json.routes[0];
    if (!best) throw new Error('No route found');
    return {
      coords: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: best.distance / 1000,
      durationMin: best.duration / 60,
    };
  } finally {
    clearTimeout(timer);
  }
}
