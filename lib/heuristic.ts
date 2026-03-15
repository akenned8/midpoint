// Heuristic travel time estimation and hotspot pre-filtering
import type { Person, Hotspot } from '@/types';
import { haversineDistance } from '@/lib/geo';
import { minimax, sumOfSquares, blended } from '@/lib/scoring';
import { lookupZoneTime, getTimeMultiplier, isInNYC } from '@/lib/zones';

// ─── Legacy heuristic (fallback for non-NYC origins) ───

const BOROUGH_SPEED_FACTORS: Record<string, number> = {
  manhattan: 3.8, brooklyn: 2.6, queens: 2.4, bronx: 2.5, staten_island: 1.4,
};

type BoroughPair = string;
const CROSSING_PENALTIES: Record<BoroughPair, number> = {
  'manhattan-brooklyn': 8 * 60, 'manhattan-queens': 6 * 60,
  'manhattan-staten_island': 32 * 60, 'manhattan-bronx': 6 * 60,
  'brooklyn-queens': 10 * 60, 'brooklyn-staten_island': 38 * 60,
  'brooklyn-bronx': 14 * 60, 'queens-staten_island': 42 * 60,
  'queens-bronx': 10 * 60, 'bronx-staten_island': 45 * 60,
};

function getCrossingPenalty(b1: string, b2: string): number {
  if (b1 === b2) return 0;
  return CROSSING_PENALTIES[`${b1}-${b2}`] ?? CROSSING_PENALTIES[`${b2}-${b1}`] ?? 10 * 60;
}

interface Hub { lat: number; lng: number; bonusSeconds: number; radiusMeters: number; }
const TRANSIT_HUBS: Hub[] = [
  { lat: 40.7580, lng: -73.9855, bonusSeconds: 8 * 60, radiusMeters: 600 },
  { lat: 40.7359, lng: -73.9911, bonusSeconds: 7 * 60, radiusMeters: 500 },
  { lat: 40.7527, lng: -73.9772, bonusSeconds: 6 * 60, radiusMeters: 500 },
  { lat: 40.6862, lng: -73.9776, bonusSeconds: 5 * 60, radiusMeters: 400 },
  { lat: 40.7484, lng: -73.9967, bonusSeconds: 5 * 60, radiusMeters: 500 },
  { lat: 40.7128, lng: -74.0060, bonusSeconds: 4 * 60, radiusMeters: 400 },
  { lat: 40.7553, lng: -73.9875, bonusSeconds: 4 * 60, radiusMeters: 400 },
  { lat: 40.6940, lng: -73.9904, bonusSeconds: 3 * 60, radiusMeters: 350 },
];

const WALKING_SPEED_MS = 1.4;
const CYCLING_SPEED_MS = 4.5;
const DRIVING_SPEED_MS = 6.7;
const TRANSIT_BASE_SPEED_MS = 8.9;
const ACCESS_EGRESS_SECONDS = 5 * 60;

function getHubBonus(lat: number, lng: number): number {
  let maxBonus = 0;
  for (const hub of TRANSIT_HUBS) {
    const dist = haversineDistance(lat, lng, hub.lat, hub.lng);
    if (dist <= hub.radiusMeters) maxBonus = Math.max(maxBonus, hub.bonusSeconds);
  }
  return maxBonus;
}

function detectPersonBorough(lat: number, lng: number): string | null {
  const boroughs: [string, number, number][] = [
    ['manhattan', 40.776, -73.972], ['brooklyn', 40.650, -73.950],
    ['queens', 40.683, -73.830], ['bronx', 40.845, -73.864],
    ['staten_island', 40.579, -74.151],
  ];
  if (lat < 40.48 || lat > 40.93 || lng < -74.27 || lng > -73.68) return null;
  let closest: string | null = null;
  let minDist = Infinity;
  for (const [name, cLat, cLng] of boroughs) {
    const d = haversineDistance(lat, lng, cLat, cLng);
    if (d < minDist) { minDist = d; closest = name; }
  }
  return closest;
}

function legacyEstimate(person: Person, hotspot: Hotspot): number {
  const dist = haversineDistance(person.lat, person.lng, hotspot.lat, hotspot.lng);

  switch (person.mode) {
    case 'walking':
      return dist / WALKING_SPEED_MS;
    case 'cycling':
      return dist / CYCLING_SPEED_MS * 1.2;
    case 'driving': {
      const base = dist / DRIVING_SPEED_MS;
      const parkingPenalty = hotspot.borough === 'manhattan' ? 5 * 60 : 0;
      return base * 1.3 + parkingPenalty;
    }
    case 'transit':
    default: {
      const speedFactor = BOROUGH_SPEED_FACTORS[hotspot.borough] ?? 2.5;
      const inVehicleTime = (dist / TRANSIT_BASE_SPEED_MS) * speedFactor;
      const personBorough = detectPersonBorough(person.lat, person.lng);
      const crossingPenalty = personBorough ? getCrossingPenalty(personBorough, hotspot.borough) : 0;
      const hubBonus = getHubBonus(hotspot.lat, hotspot.lng);
      return Math.max(3 * 60, ACCESS_EGRESS_SECONDS + inVehicleTime + crossingPenalty - hubBonus);
    }
  }
}

// ─── Main estimation function ───

export function estimateTransitTime(
  person: Person,
  hotspot: Hotspot,
  departureTime?: string
): number {
  // Outside NYC: use legacy heuristic with time-of-day multiplier
  if (!isInNYC(person.lat, person.lng)) {
    const base = legacyEstimate(person, hotspot);
    return base * getTimeMultiplier(person.mode, departureTime);
  }

  // Inside NYC: use precomputed zone-to-zone matrix
  const base = lookupZoneTime(
    person.lat, person.lng,
    hotspot.lat, hotspot.lng,
    person.mode
  );
  return base * getTimeMultiplier(person.mode, departureTime);
}

// ─── Pre-filter ───

export type ObjectiveFunction = 'fairness' | 'efficiency' | 'blended';

export function preFilterHotspots(
  people: Person[],
  hotspots: Hotspot[],
  objective: ObjectiveFunction = 'blended',
  alpha: number = 0.7,
  count: number = 16,
  departureTime?: string
): Hotspot[] {
  if (hotspots.length === 0 || people.length === 0) return [];

  // Score every hotspot
  const scored = hotspots.map((h) => {
    const times = people.map((p) => estimateTransitTime(p, h, departureTime));
    let score: number;
    switch (objective) {
      case 'fairness': score = minimax(times); break;
      case 'efficiency': score = sumOfSquares(times); break;
      case 'blended': default: score = blended(times, alpha); break;
    }
    return { hotspot: h, score, times };
  });

  scored.sort((a, b) => a.score - b.score);
  const bestScore = scored[0].score;
  const viabilityThreshold = bestScore * 2;

  // Reserve top candidate from each borough within viability threshold
  const reserved: typeof scored = [];
  const seenBoroughs = new Set<string>();
  for (const entry of scored) {
    if (entry.score > viabilityThreshold) break;
    if (!seenBoroughs.has(entry.hotspot.borough)) {
      seenBoroughs.add(entry.hotspot.borough);
      reserved.push(entry);
    }
  }

  // Fill remaining slots with 500m dedup
  const reservedIds = new Set(reserved.map((r) => r.hotspot.id));
  const remaining = scored.filter((s) => !reservedIds.has(s.hotspot.id));
  const allSelected = [...reserved];
  const selectedHotspots = reserved.map((r) => r.hotspot);

  for (const entry of remaining) {
    if (allSelected.length >= count) break;
    const tooClose = selectedHotspots.some(
      (s) => haversineDistance(entry.hotspot.lat, entry.hotspot.lng, s.lat, s.lng) < 500
    );
    if (!tooClose) {
      allSelected.push(entry);
      selectedHotspots.push(entry.hotspot);
    }
  }

  return allSelected.map((s) => s.hotspot);
}
