// Haversine distance, geohash, borough detection, dedup helpers

const EARTH_RADIUS_M = 6_371_000;

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash(lat: number, lng: number, precision: number): string {
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let isLng = true;

  while (hash.length < precision) {
    const mid = isLng ? (minLng + maxLng) / 2 : (minLat + maxLat) / 2;
    const val = isLng ? lng : lat;

    if (val >= mid) {
      ch |= 1 << (4 - bit);
      if (isLng) minLng = mid; else minLat = mid;
    } else {
      if (isLng) maxLng = mid; else maxLat = mid;
    }

    isLng = !isLng;
    bit++;

    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

// Approximate borough bounding boxes for NYC
// These are simplified polygons — good enough for hotspot classification
type Borough = 'manhattan' | 'brooklyn' | 'queens' | 'bronx' | 'staten_island';

interface BoroughBounds {
  borough: Borough;
  lat: [number, number]; // [min, max]
  lng: [number, number]; // [min, max]
}

const BOROUGH_BOUNDS: BoroughBounds[] = [
  { borough: 'manhattan',      lat: [40.700, 40.882], lng: [-74.020, -73.907] },
  { borough: 'brooklyn',       lat: [40.570, 40.739], lng: [-74.042, -73.855] },
  { borough: 'queens',         lat: [40.541, 40.812], lng: [-73.962, -73.700] },
  { borough: 'bronx',          lat: [40.785, 40.917], lng: [-73.933, -73.765] },
  { borough: 'staten_island',  lat: [40.496, 40.651], lng: [-74.255, -74.052] },
];

export function detectBorough(lat: number, lng: number): Borough | null {
  // Check Manhattan first with a tighter lng bound to avoid overlap with Queens/Brooklyn
  if (lat >= 40.700 && lat <= 40.882 && lng >= -74.020 && lng <= -73.934) {
    return 'manhattan';
  }
  // For overlapping regions, use distance to borough centroid as tiebreaker
  const candidates: Borough[] = [];
  for (const b of BOROUGH_BOUNDS) {
    if (lat >= b.lat[0] && lat <= b.lat[1] && lng >= b.lng[0] && lng <= b.lng[1]) {
      candidates.push(b.borough);
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Tiebreak by centroid distance
  const centroids: Record<Borough, [number, number]> = {
    manhattan:     [40.776, -73.972],
    brooklyn:      [40.650, -73.950],
    queens:        [40.683, -73.830],
    bronx:         [40.845, -73.864],
    staten_island: [40.579, -74.151],
  };

  let best: Borough = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const [cLat, cLng] = centroids[c];
    const d = haversineDistance(lat, lng, cLat, cLng);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export function dedup<T extends { lat: number; lng: number }>(
  points: T[], radiusMeters: number
): T[] {
  const kept: T[] = [];
  for (const p of points) {
    const tooClose = kept.some(
      (k) => haversineDistance(p.lat, p.lng, k.lat, k.lng) < radiusMeters
    );
    if (!tooClose) kept.push(p);
  }
  return kept;
}
