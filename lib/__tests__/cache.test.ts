import { describe, it, expect } from 'vitest';
import { timeBucketKey, travelTimeCacheKey, venueCacheKey, isochroneCacheKey } from '@/lib/cache';

describe('timeBucketKey', () => {
  it('returns "any" for walking (no time dimension)', () => {
    expect(timeBucketKey('2026-03-14T18:00:00Z', 'walking')).toBe('any');
  });

  it('returns "any" for cycling (no time dimension)', () => {
    expect(timeBucketKey('2026-03-14T18:00:00Z', 'cycling')).toBe('any');
  });

  it('buckets transit to 30-minute windows', () => {
    const key1 = timeBucketKey('2026-03-14T18:00:00Z', 'transit');
    const key2 = timeBucketKey('2026-03-14T18:14:00Z', 'transit');
    const key3 = timeBucketKey('2026-03-14T18:31:00Z', 'transit');
    // First two should be same bucket, third different
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it('buckets driving to 1-hour windows', () => {
    const key1 = timeBucketKey('2026-03-14T18:00:00Z', 'driving');
    const key2 = timeBucketKey('2026-03-14T18:45:00Z', 'driving');
    const key3 = timeBucketKey('2026-03-14T19:01:00Z', 'driving');
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });
});

describe('travelTimeCacheKey', () => {
  it('produces deterministic keys', () => {
    const k1 = travelTimeCacheKey('transit', 40.758, -73.985, 40.686, -73.977, '2026-03-14T18:00:00Z');
    const k2 = travelTimeCacheKey('transit', 40.758, -73.985, 40.686, -73.977, '2026-03-14T18:00:00Z');
    expect(k1).toBe(k2);
  });

  it('differs by mode', () => {
    const k1 = travelTimeCacheKey('transit', 40.758, -73.985, 40.686, -73.977, '2026-03-14T18:00:00Z');
    const k2 = travelTimeCacheKey('driving', 40.758, -73.985, 40.686, -73.977, '2026-03-14T18:00:00Z');
    expect(k1).not.toBe(k2);
  });

  it('starts with tt: prefix', () => {
    const key = travelTimeCacheKey('walking', 40.758, -73.985, 40.686, -73.977, 'now');
    expect(key.startsWith('tt:')).toBe(true);
  });
});

describe('venueCacheKey', () => {
  it('produces deterministic keys', () => {
    const k1 = venueCacheKey(40.758, -73.985, 400);
    const k2 = venueCacheKey(40.758, -73.985, 400);
    expect(k1).toBe(k2);
  });

  it('starts with venues: prefix', () => {
    expect(venueCacheKey(40.758, -73.985, 400).startsWith('venues:')).toBe(true);
  });
});

describe('isochroneCacheKey', () => {
  it('starts with iso: prefix', () => {
    expect(isochroneCacheKey(40.758, -73.985, 'driving', 15).startsWith('iso:')).toBe(true);
  });
});
