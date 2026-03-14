// Full pipeline orchestrator: heuristic → API → score → venues
import type { Person, TravelTimeResult } from '@/types';

// TODO: Run the full optimization pipeline:
// 1. Pre-filter hotspots using heuristic
// 2. Fetch real travel times via Google Routes API
// 3. Score candidates using selected objective
// 4. Fetch venues near top candidates via Google Places API
export async function optimize(
  _people: Person[],
  _objective: string,
  _alpha: number,
  _departureTime: string
): Promise<TravelTimeResult[]> {
  return [];
}
