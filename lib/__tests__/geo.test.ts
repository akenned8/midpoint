import { describe, it, expect } from 'vitest';
import { haversineDistance, geohash, detectBorough, dedup } from '@/lib/geo';

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it('calculates ~1.0 km between Times Square and Bryant Park', () => {
    // Times Square: 40.7580, -73.9855
    // Bryant Park: 40.7536, -73.9832
    const dist = haversineDistance(40.7580, -73.9855, 40.7536, -73.9832);
    expect(dist).toBeGreaterThan(400);
    expect(dist).toBeLessThan(600);
  });

  it('calculates ~8.5 km between Times Square and Atlantic Terminal', () => {
    const dist = haversineDistance(40.7580, -73.9855, 40.6862, -73.9776);
    expect(dist).toBeGreaterThan(7500);
    expect(dist).toBeLessThan(9500);
  });
});

describe('geohash', () => {
  it('returns a string of the specified precision', () => {
    const hash = geohash(40.7128, -74.006, 7);
    expect(hash).toHaveLength(7);
  });

  it('returns the same hash for nearby points at low precision', () => {
    const h1 = geohash(40.7580, -73.9855, 5);
    const h2 = geohash(40.7536, -73.9832, 5);
    expect(h1).toBe(h2);
  });

  it('returns different hashes for distant points', () => {
    const manhattan = geohash(40.7580, -73.9855, 6);
    const statenIsland = geohash(40.5795, -74.1502, 6);
    expect(manhattan).not.toBe(statenIsland);
  });
});

describe('detectBorough', () => {
  it('detects Manhattan for Times Square', () => {
    expect(detectBorough(40.7580, -73.9855)).toBe('manhattan');
  });

  it('detects Brooklyn for Prospect Park', () => {
    expect(detectBorough(40.6602, -73.9690)).toBe('brooklyn');
  });

  it('detects Queens for Flushing', () => {
    expect(detectBorough(40.7580, -73.8330)).toBe('queens');
  });

  it('detects Bronx for Yankee Stadium', () => {
    expect(detectBorough(40.8296, -73.9262)).toBe('bronx');
  });

  it('detects Staten Island for St. George', () => {
    expect(detectBorough(40.6433, -74.0764)).toBe('staten_island');
  });

  it('returns null for points outside NYC', () => {
    expect(detectBorough(41.0, -74.5)).toBeNull();
  });
});

describe('dedup', () => {
  it('removes points within radius of higher-ranked points', () => {
    const points = [
      { lat: 40.7580, lng: -73.9855, id: 'a' },
      { lat: 40.7581, lng: -73.9856, id: 'b' }, // ~15m from a
      { lat: 40.7000, lng: -73.9500, id: 'c' }, // far away
    ];
    const result = dedup(points, 500);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('c');
  });

  it('keeps all points if none are within radius', () => {
    const points = [
      { lat: 40.7580, lng: -73.9855 },
      { lat: 40.7000, lng: -73.9500 },
      { lat: 40.6500, lng: -73.9200 },
    ];
    const result = dedup(points, 500);
    expect(result).toHaveLength(3);
  });

  it('returns empty for empty input', () => {
    expect(dedup([], 500)).toEqual([]);
  });
});
