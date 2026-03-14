// Full pipeline orchestrator: heuristic → API → score → venues
import type { Person, Hotspot, TravelTimeResult, Venue, ObjectiveType } from '@/types';
import { preFilterHotspots, estimateTransitTime } from '@/lib/heuristic';
import { minimax, sumOfSquares, blended } from '@/lib/scoring';
import {
  getCached,
  setCached,
  getTTL,
  travelTimeCacheKey,
  venueCacheKey,
} from '@/lib/cache';

export type PipelineStage =
  | 'prefilter'
  | 'travel_times'
  | 'scoring'
  | 'venues'
  | 'done';

interface OptimizeOptions {
  people: Person[];
  hotspots: Hotspot[];
  objective: ObjectiveType;
  alpha: number;
  departureTime: string;
}

export interface OptimizeResult {
  rankings: TravelTimeResult[];
  venues: Venue[];
  candidateDetails: { hotspotId: string; neighborhood: string; borough: string; lat: number; lng: number }[];
  stages: { stage: PipelineStage; durationMs: number; detail: string }[];
  usedHeuristic: boolean;
}

const GOOGLE_TRAVEL_MODE: Record<string, string> = {
  transit: 'TRANSIT',
  driving: 'DRIVE',
  walking: 'WALK',
  cycling: 'BICYCLE',
};

const ROUTES_API_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const PLACES_API_URL = 'https://places.googleapis.com/v1/places:searchNearby';

export async function optimize(options: OptimizeOptions): Promise<OptimizeResult> {
  const { people, hotspots, objective, alpha, departureTime } = options;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const stages: OptimizeResult['stages'] = [];

  // Stage 1: Heuristic pre-filter
  let t0 = Date.now();
  const candidates = preFilterHotspots(people, hotspots, objective, alpha, 16);
  stages.push({ stage: 'prefilter', durationMs: Date.now() - t0, detail: `${candidates.length} candidates from ${hotspots.length} hotspots` });

  if (candidates.length === 0) {
    return { rankings: [], venues: [], candidateDetails: [], stages, usedHeuristic: true };
  }

  const candidateDetails = candidates.map((h) => ({
    hotspotId: h.id,
    neighborhood: h.neighborhood,
    borough: h.borough,
    lat: h.lat,
    lng: h.lng,
  }));

  // Stage 2: Fetch real travel times directly from Google Routes API
  t0 = Date.now();
  let matrix: (number | null)[][] = [];
  let usedHeuristic = true;

  if (apiKey) {
    try {
      matrix = await fetchTravelTimesDirectly(people, candidates, departureTime, apiKey);
      if (matrix.length > 0) usedHeuristic = false;
    } catch (err) {
      console.error('Routes API direct call failed:', err);
    }
  }

  stages.push({
    stage: 'travel_times',
    durationMs: Date.now() - t0,
    detail: usedHeuristic ? 'Using heuristic estimates (API unavailable)' : `${people.length}x${candidates.length} matrix from Google Routes API`,
  });

  // Stage 3: Score candidates
  t0 = Date.now();
  const rankings: TravelTimeResult[] = candidates.map((hotspot, di) => {
    const times = people.map((person, pi) => {
      if (!usedHeuristic && matrix[pi]?.[di] != null) {
        return matrix[pi][di] as number;
      }
      return estimateTransitTime(person, hotspot);
    });

    let score: number;
    switch (objective) {
      case 'fairness': score = minimax(times); break;
      case 'efficiency': score = sumOfSquares(times); break;
      case 'blended': default: score = blended(times, alpha); break;
    }

    return { hotspotId: hotspot.id, times, score };
  });

  rankings.sort((a, b) => a.score - b.score);
  stages.push({ stage: 'scoring', durationMs: Date.now() - t0, detail: `Scored ${rankings.length} candidates` });

  // Stage 4: Fetch venues near top 5
  t0 = Date.now();
  let venues: Venue[] = [];
  if (apiKey) {
    const topCandidates = rankings.slice(0, 5);
    const locations = topCandidates.map((r) => {
      const h = candidates.find((c) => c.id === r.hotspotId)!;
      return { lat: h.lat, lng: h.lng };
    });

    try {
      venues = await fetchVenuesDirectly(locations, apiKey);
    } catch (err) {
      console.error('Places API direct call failed:', err);
    }
  }

  stages.push({
    stage: 'venues',
    durationMs: Date.now() - t0,
    detail: venues.length > 0 ? `Found ${venues.length} venues` : 'No venues found (showing neighborhoods)',
  });
  stages.push({ stage: 'done', durationMs: 0, detail: '' });

  return { rankings, venues, candidateDetails, stages, usedHeuristic };
}

// Direct Google Routes API call (no internal fetch)
async function fetchTravelTimesDirectly(
  people: Person[],
  candidates: Hotspot[],
  departureTime: string,
  apiKey: string,
): Promise<(number | null)[][]> {
  const results: (number | null)[][] = Array.from(
    { length: people.length },
    () => Array(candidates.length).fill(null)
  );

  // Group people by mode
  const byMode = new Map<string, number[]>();
  for (let i = 0; i < people.length; i++) {
    const mode = people[i].mode;
    const group = byMode.get(mode) ?? [];
    group.push(i);
    byMode.set(mode, group);
  }

  for (const [mode, personIndices] of byMode) {
    // Check cache first
    const uncached: { pi: number; di: number }[] = [];
    for (const pi of personIndices) {
      for (let di = 0; di < candidates.length; di++) {
        const key = travelTimeCacheKey(
          people[pi].mode, people[pi].lat, people[pi].lng,
          candidates[di].lat, candidates[di].lng, departureTime
        );
        const cached = await getCached<number>(key);
        if (cached !== null) {
          results[pi][di] = cached;
        } else {
          uncached.push({ pi, di });
        }
      }
    }

    if (uncached.length === 0) continue;

    const origins = personIndices.map((pi) => ({
      waypoint: {
        location: {
          latLng: { latitude: people[pi].lat, longitude: people[pi].lng },
        },
      },
    }));

    const destinations = candidates.map((h) => ({
      waypoint: {
        location: {
          latLng: { latitude: h.lat, longitude: h.lng },
        },
      },
    }));

    const requestBody: Record<string, unknown> = {
      origins,
      destinations,
      travelMode: GOOGLE_TRAVEL_MODE[mode] ?? 'TRANSIT',
    };

    if (mode === 'transit' || mode === 'driving') {
      requestBody.departureTime =
        departureTime === 'now' ? new Date().toISOString() : departureTime;
    }
    if (mode === 'transit') {
      requestBody.transitPreferences = { routingPreference: 'FEWER_TRANSFERS' };
    }

    const response = await fetch(ROUTES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error('Routes API error:', response.status, await response.text());
      continue;
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      for (const element of data) {
        if (element.status?.code && element.status.code !== 0) continue;
        const localOi = element.originIndex ?? 0;
        const localDi = element.destinationIndex ?? 0;
        const globalPi = personIndices[localOi];

        const durationStr: string = element.duration ?? '0s';
        const seconds = parseInt(durationStr.replace('s', ''), 10);

        results[globalPi][localDi] = seconds;

        // Cache
        const key = travelTimeCacheKey(
          people[globalPi].mode, people[globalPi].lat, people[globalPi].lng,
          candidates[localDi].lat, candidates[localDi].lng, departureTime
        );
        setCached(key, seconds, getTTL(people[globalPi].mode));
      }
    }
  }

  return results;
}

// Direct Google Places API call (no internal fetch)
async function fetchVenuesDirectly(
  locations: { lat: number; lng: number }[],
  apiKey: string,
): Promise<Venue[]> {
  const allVenues: Venue[] = [];
  const seenPlaceIds = new Set<string>();

  for (const loc of locations) {
    const cacheKey = venueCacheKey(loc.lat, loc.lng, 400);
    const cached = await getCached<Venue[]>(cacheKey);
    if (cached) {
      for (const v of cached) {
        if (!seenPlaceIds.has(v.placeId)) {
          seenPlaceIds.add(v.placeId);
          allVenues.push(v);
        }
      }
      continue;
    }

    const response = await fetch(PLACES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.rating,' +
          'places.userRatingCount,places.types,places.priceLevel',
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: {
            center: { latitude: loc.lat, longitude: loc.lng },
            radius: 400,
          },
        },
        maxResultCount: 10,
        includedTypes: ['restaurant', 'bar', 'cafe'],
      }),
    });

    if (!response.ok) {
      console.error('Places API error:', response.status, await response.text());
      continue;
    }

    const data = await response.json();
    const PRICE_MAP: Record<string, number> = {
      PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4,
    };

    const venues: Venue[] = (data.places ?? []).map((p: Record<string, unknown>) => {
      const location = p.location as { latitude: number; longitude: number } | undefined;
      const displayName = p.displayName as { text: string } | undefined;
      return {
        placeId: p.id as string,
        name: displayName?.text ?? 'Unknown',
        lat: location?.latitude ?? 0,
        lng: location?.longitude ?? 0,
        rating: (p.rating as number) ?? 0,
        reviewCount: (p.userRatingCount as number) ?? 0,
        types: (p.types as string[]) ?? [],
        priceLevel: PRICE_MAP[p.priceLevel as string] ?? undefined,
        neighborhood: '',
        travelTimes: [],
      };
    });

    setCached(cacheKey, venues, 24 * 60 * 60);

    for (const v of venues) {
      if (!seenPlaceIds.has(v.placeId)) {
        seenPlaceIds.add(v.placeId);
        allVenues.push(v);
      }
    }
  }

  // Sort by quality
  allVenues.sort((a, b) => {
    const scoreA = a.rating * 0.6 + Math.log(a.reviewCount + 1) * 0.4;
    const scoreB = b.rating * 0.6 + Math.log(b.reviewCount + 1) * 0.4;
    return scoreB - scoreA;
  });

  return allVenues;
}
