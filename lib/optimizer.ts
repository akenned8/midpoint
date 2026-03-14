// Full pipeline orchestrator: heuristic → API → score → venues
import type { Person, Hotspot, TravelTimeResult, Venue, ObjectiveType } from '@/types';
import { preFilterHotspots, estimateTransitTime } from '@/lib/heuristic';
import { minimax, sumOfSquares, blended } from '@/lib/scoring';

interface OptimizeOptions {
  people: Person[];
  hotspots: Hotspot[];
  objective: ObjectiveType;
  alpha: number;
  departureTime: string;
  baseUrl: string; // for internal API calls
}

interface OptimizeResult {
  rankings: TravelTimeResult[];
  venues: Venue[];
}

export async function optimize(options: OptimizeOptions): Promise<OptimizeResult> {
  const { people, hotspots, objective, alpha, departureTime, baseUrl } = options;

  // Stage 1: Heuristic pre-filter → top 16 candidates
  const candidates = preFilterHotspots(people, hotspots, objective, alpha, 16);

  if (candidates.length === 0) {
    return { rankings: [], venues: [] };
  }

  // Stage 2: Fetch real travel times via Routes API
  const origins = people.map((p) => ({ lat: p.lat, lng: p.lng, mode: p.mode }));
  const destinations = candidates.map((h) => ({ lat: h.lat, lng: h.lng }));

  let matrix: (number | null)[][] = [];
  try {
    const timesRes = await fetch(`${baseUrl}/api/times`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origins, destinations, departureTime }),
    });
    if (timesRes.ok) {
      const data = await timesRes.json();
      matrix = data.matrix;
    }
  } catch (err) {
    console.error('Failed to fetch travel times:', err);
  }

  // If API failed, fall back to heuristic times
  const useHeuristic = matrix.length === 0;

  // Stage 3: Score candidates
  const rankings: TravelTimeResult[] = candidates.map((hotspot, di) => {
    const times = people.map((person, pi) => {
      if (!useHeuristic && matrix[pi]?.[di] != null) {
        return matrix[pi][di] as number;
      }
      // Fallback: use heuristic estimate
      return estimateTransitTime(person, hotspot);
    });

    let score: number;
    switch (objective) {
      case 'fairness':
        score = minimax(times);
        break;
      case 'efficiency':
        score = sumOfSquares(times);
        break;
      case 'blended':
      default:
        score = blended(times, alpha);
        break;
    }

    return { hotspotId: hotspot.id, times, score };
  });

  // Sort by score ascending
  rankings.sort((a, b) => a.score - b.score);

  // Stage 4: Fetch venues near top 5 scoring hotspots
  const topHotspots = rankings.slice(0, 5);
  const venueLocations = topHotspots.map((r) => {
    const h = candidates.find((c) => c.id === r.hotspotId)!;
    return { lat: h.lat, lng: h.lng };
  });

  let venues: Venue[] = [];
  try {
    const venuesRes = await fetch(`${baseUrl}/api/venues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: venueLocations }),
    });
    if (venuesRes.ok) {
      const data = await venuesRes.json();
      venues = (data.venues ?? []).map((v: Record<string, unknown>) => ({
        placeId: v.placeId as string,
        name: v.name as string,
        lat: v.lat as number,
        lng: v.lng as number,
        rating: v.rating as number,
        reviewCount: v.reviewCount as number,
        types: v.types as string[],
        priceLevel: v.priceLevel as number | undefined,
        neighborhood: (v.neighborhood as string) ?? '',
        travelTimes: [], // will be filled by caller if needed
      }));
    }
  } catch (err) {
    console.error('Failed to fetch venues:', err);
  }

  return { rankings, venues };
}
