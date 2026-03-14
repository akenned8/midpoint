// Haversine distance, geohash, borough detection, dedup helpers

// TODO: Calculate haversine distance between two lat/lng points in meters
export function haversineDistance(
  _lat1: number, _lng1: number,
  _lat2: number, _lng2: number
): number {
  return 0;
}

// TODO: Generate geohash string for a lat/lng at given precision
export function geohash(_lat: number, _lng: number, _precision: number): string {
  return '';
}

// TODO: Detect which NYC borough a lat/lng falls in
export function detectBorough(
  _lat: number, _lng: number
): 'manhattan' | 'brooklyn' | 'queens' | 'bronx' | 'staten_island' | null {
  return null;
}

// TODO: Deduplicate points within a given radius (meters)
export function dedup<T extends { lat: number; lng: number }>(
  _points: T[], _radiusMeters: number
): T[] {
  return [];
}
