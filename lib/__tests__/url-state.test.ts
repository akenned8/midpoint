import { describe, it, expect } from 'vitest';
import { encodeState, decodeState } from '@/lib/url-state';
import type { SessionState } from '@/types';

describe('url-state', () => {
  const state: SessionState = {
    people: [
      { id: '1', label: 'Alice', lat: 40.758, lng: -73.985, mode: 'transit', color: '#ff0000' },
      { id: '2', label: 'Bob', lat: 40.686, lng: -73.977, mode: 'walking', color: '#0000ff' },
    ],
    objective: 'blended',
    alpha: 0.7,
    departureTime: '2026-03-14T18:00:00Z',
  };

  it('round-trips a session state', () => {
    const encoded = encodeState(state);
    const decoded = decodeState(encoded);
    expect(decoded).toEqual(state);
  });

  it('produces a non-empty encoded string', () => {
    const encoded = encodeState(state);
    expect(encoded.length).toBeGreaterThan(0);
    expect(typeof encoded).toBe('string');
  });

  it('stays under 1500 chars for 6 people', () => {
    const bigState: SessionState = {
      people: Array.from({ length: 6 }, (_, i) => ({
        id: String(i),
        label: `Person ${i + 1}`,
        lat: 40.7 + i * 0.01,
        lng: -73.99 + i * 0.005,
        mode: 'transit' as const,
        color: `#${String(i).repeat(6).slice(0, 6)}`,
      })),
      objective: 'blended',
      alpha: 0.7,
      departureTime: '2026-03-14T18:00:00Z',
    };
    const encoded = encodeState(bigState);
    expect(encoded.length).toBeLessThan(1500);
  });

  it('returns null for invalid input', () => {
    expect(decodeState('')).toBeNull();
    expect(decodeState('garbage-data')).toBeNull();
  });
});
