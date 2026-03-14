import { describe, it, expect } from 'vitest';
import { estimateTransitTime, preFilterHotspots } from '@/lib/heuristic';
import { haversineDistance } from '@/lib/geo';
import type { Person, Hotspot } from '@/types';

const makePerson = (
  lat: number,
  lng: number,
  mode: 'transit' | 'driving' | 'walking' | 'cycling' = 'transit',
  id = '1'
): Person => ({
  id,
  label: `Person ${id}`,
  lat,
  lng,
  mode,
  color: '#ff0000',
});

const makeHotspot = (
  lat: number,
  lng: number,
  borough: Hotspot['borough'],
  id: string,
  neighborhood = 'Test'
): Hotspot => ({
  id,
  lat,
  lng,
  borough,
  neighborhood,
  nearestStation: 'Test Station',
  venueCount: 5,
});

describe('estimateTransitTime', () => {
  const timesSquare = makeHotspot(40.7580, -73.9855, 'manhattan', 'ts');

  it('returns a positive time for transit', () => {
    const person = makePerson(40.6862, -73.9776, 'transit'); // Atlantic Terminal area
    const time = estimateTransitTime(person, timesSquare);
    expect(time).toBeGreaterThan(0);
  });

  it('walking is slower than transit for same distance', () => {
    const origin = { lat: 40.7200, lng: -73.9900 };
    const walker = makePerson(origin.lat, origin.lng, 'walking');
    const rider = makePerson(origin.lat, origin.lng, 'transit');
    const walkTime = estimateTransitTime(walker, timesSquare);
    const transitTime = estimateTransitTime(rider, timesSquare);
    expect(walkTime).toBeGreaterThan(transitTime);
  });

  it('gives a minimum floor of 3 minutes for transit', () => {
    // Very close to the hotspot
    const person = makePerson(40.7580, -73.9855, 'transit');
    const time = estimateTransitTime(person, timesSquare);
    expect(time).toBeGreaterThanOrEqual(3 * 60);
  });

  it('estimates reasonable times for cycling', () => {
    const person = makePerson(40.7200, -73.9900, 'cycling');
    const time = estimateTransitTime(person, timesSquare);
    // ~4.5 km, cycling ~16 km/h → ~17 min, with overhead ~20 min
    expect(time).toBeGreaterThan(10 * 60);
    expect(time).toBeLessThan(30 * 60);
  });
});

describe('preFilterHotspots', () => {
  // Create hotspots spread across boroughs
  const hotspots: Hotspot[] = [
    // Manhattan cluster
    makeHotspot(40.7580, -73.9855, 'manhattan', 'mn1', 'Times Square'),
    makeHotspot(40.7484, -73.9856, 'manhattan', 'mn2', 'Herald Square'),
    makeHotspot(40.7359, -73.9911, 'manhattan', 'mn3', 'Union Square'),
    makeHotspot(40.7128, -74.0060, 'manhattan', 'mn4', 'FiDi'),
    makeHotspot(40.7831, -73.9712, 'manhattan', 'mn5', 'UWS'),
    // Brooklyn
    makeHotspot(40.6862, -73.9776, 'brooklyn', 'bk1', 'Fort Greene'),
    makeHotspot(40.6782, -73.9442, 'brooklyn', 'bk2', 'Crown Heights'),
    makeHotspot(40.6892, -73.9857, 'brooklyn', 'bk3', 'Downtown BK'),
    // Queens
    makeHotspot(40.7428, -73.9188, 'queens', 'qn1', 'Sunnyside'),
    makeHotspot(40.7505, -73.8765, 'queens', 'qn2', 'Jackson Heights'),
    // Bronx
    makeHotspot(40.8296, -73.9262, 'bronx', 'bx1', 'South Bronx'),
    // Staten Island
    makeHotspot(40.6433, -74.0764, 'staten_island', 'si1', 'St George'),
  ];

  it('returns at most `count` hotspots', () => {
    const people = [
      makePerson(40.7580, -73.9855, 'transit', '1'),
      makePerson(40.6862, -73.9776, 'transit', '2'),
    ];
    const result = preFilterHotspots(people, hotspots, 'blended', 0.7, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('enforces borough diversity', () => {
    // 5 people in Manhattan — should still include non-Manhattan boroughs
    const people = [
      makePerson(40.758, -73.985, 'transit', '1'),
      makePerson(40.748, -73.986, 'transit', '2'),
      makePerson(40.736, -73.991, 'transit', '3'),
      makePerson(40.770, -73.982, 'transit', '4'),
      makePerson(40.741, -73.990, 'transit', '5'),
    ];
    const result = preFilterHotspots(people, hotspots, 'blended', 0.7, 16);
    const boroughs = new Set(result.map((h) => h.borough));
    // Should have at least Manhattan + Brooklyn (nearby and viable)
    expect(boroughs.has('manhattan')).toBe(true);
    expect(boroughs.size).toBeGreaterThan(1);
  });

  it('deduplicates at 500m', () => {
    const people = [makePerson(40.6862, -73.9776, 'transit', '1')];
    const result = preFilterHotspots(people, hotspots, 'blended', 0.7, 16);
    // Check that no two results are within 500m
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const dist = haversineDistance(
          result[i].lat, result[i].lng,
          result[j].lat, result[j].lng
        );
        expect(dist).toBeGreaterThanOrEqual(500);
      }
    }
  });

  it('returns empty for empty inputs', () => {
    expect(preFilterHotspots([], hotspots)).toEqual([]);
    expect(preFilterHotspots([makePerson(40.7, -74.0, 'transit')], [])).toEqual([]);
  });
});
