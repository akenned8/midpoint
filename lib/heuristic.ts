// Heuristic travel time estimation and hotspot pre-filtering
import type { Person, Hotspot } from '@/types';

// TODO: Estimate transit time using haversine distance, borough speed factors, and crossing penalties
export function estimateTransitTime(_person: Person, _hotspot: Hotspot): number {
  return 0;
}

// TODO: Pre-filter hotspots to top 16 candidates with borough diversity floor and 500m dedup
export function preFilterHotspots(_people: Person[], _hotspots: Hotspot[]): Hotspot[] {
  return [];
}
