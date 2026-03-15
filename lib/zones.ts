// Zone-based travel time lookup with IDW interpolation and time-of-day multipliers
import type { Zone, TransportMode } from '@/types';
import { haversineDistance } from '@/lib/geo';
import zonesData from '@/data/zones-nyc.json';
import zoneTimesData from '@/data/zone-times.json';

const zones: Zone[] = zonesData as Zone[];
const zoneTimes = zoneTimesData as Record<string, Record<string, number>>;

// NYC bounding box
const NYC_BOUNDS = { minLat: 40.48, maxLat: 40.93, minLng: -74.27, maxLng: -73.68 };

export function isInNYC(lat: number, lng: number): boolean {
  return lat >= NYC_BOUNDS.minLat && lat <= NYC_BOUNDS.maxLat &&
         lng >= NYC_BOUNDS.minLng && lng <= NYC_BOUNDS.maxLng;
}

export function findNearestZones(
  lat: number, lng: number, count: number
): { zone: Zone; distance: number }[] {
  const withDist = zones.map((z) => ({
    zone: z,
    distance: haversineDistance(lat, lng, z.lat, z.lng),
  }));
  withDist.sort((a, b) => a.distance - b.distance);
  return withDist.slice(0, count);
}

// Snap threshold: if within 200m of a zone centroid, use that zone directly
const SNAP_RADIUS_M = 200;
// Minimum distance for IDW weight (avoid division spikes)
const MIN_DIST_M = 100;
// Access/egress time for same-zone lookups (walking to/from a nearby spot)
const SAME_ZONE_BASE_SECONDS = 180; // 3 min

export function lookupZoneTime(
  originLat: number, originLng: number,
  destLat: number, destLng: number,
  mode: TransportMode
): number {
  const modeMatrix = zoneTimes[mode];
  if (!modeMatrix) return 0;

  const originNearest = findNearestZones(originLat, originLng, 3);
  const destNearest = findNearestZones(destLat, destLng, 3);

  // Snap if very close to a centroid
  const originZones = originNearest[0].distance <= SNAP_RADIUS_M
    ? [originNearest[0]]
    : originNearest;
  const destZones = destNearest[0].distance <= SNAP_RADIUS_M
    ? [destNearest[0]]
    : destNearest;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const o of originZones) {
    const oWeight = 1 / Math.max(o.distance, MIN_DIST_M);
    for (const d of destZones) {
      const dWeight = 1 / Math.max(d.distance, MIN_DIST_M);
      const weight = oWeight * dWeight;

      if (o.zone.id === d.zone.id) {
        weightedSum += weight * SAME_ZONE_BASE_SECONDS;
        totalWeight += weight;
      } else {
        const key = `${o.zone.id}:${d.zone.id}`;
        const seconds = modeMatrix[key];
        if (seconds != null) {
          weightedSum += weight * seconds;
          totalWeight += weight;
        }
      }
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : SAME_ZONE_BASE_SECONDS;
}

// Time-of-day multipliers
const RUSH_MULTIPLIERS: Record<TransportMode, number> = {
  transit: 1.15,
  driving: 1.4,
  walking: 1.0,
  cycling: 1.0,
};

export function getTimeMultiplier(mode: TransportMode, departureTime?: string): number {
  if (!departureTime || departureTime === 'now') {
    // Use current hour in ET
    const hour = getCurrentETHour();
    return isRushHour(hour) ? RUSH_MULTIPLIERS[mode] : 1.0;
  }

  try {
    const hour = getETHour(departureTime);
    return isRushHour(hour) ? RUSH_MULTIPLIERS[mode] : 1.0;
  } catch {
    return 1.0;
  }
}

function isRushHour(hour: number): boolean {
  return (hour >= 7 && hour < 10) || (hour >= 16 && hour < 19);
}

function getCurrentETHour(): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(new Date()), 10);
}

function getETHour(isoString: string): number {
  const date = new Date(isoString);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(date), 10);
}
