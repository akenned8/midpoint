import { describe, it, expect } from 'vitest';
import { minimax, sumOfSquares, blended, detectOutlier } from '@/lib/scoring';

describe('minimax', () => {
  it('returns the maximum value', () => {
    expect(minimax([600, 900, 1200])).toBe(1200);
  });

  it('handles single value', () => {
    expect(minimax([500])).toBe(500);
  });

  it('handles equal values', () => {
    expect(minimax([800, 800, 800])).toBe(800);
  });
});

describe('sumOfSquares', () => {
  it('returns sum of squared values', () => {
    expect(sumOfSquares([10, 20, 30])).toBe(100 + 400 + 900);
  });

  it('returns 0 for all zeros', () => {
    expect(sumOfSquares([0, 0, 0])).toBe(0);
  });
});

describe('blended', () => {
  it('equals minimax when alpha=1', () => {
    const times = [600, 900, 1200];
    const result = blended(times, 1);
    expect(result).toBe(minimax(times));
  });

  it('equals mean when alpha=0', () => {
    const times = [600, 900, 1200];
    const mean = (600 + 900 + 1200) / 3;
    expect(blended(times, 0)).toBe(mean);
  });

  it('returns value between mean and max for alpha=0.5', () => {
    const times = [600, 900, 1200];
    const result = blended(times, 0.5);
    const mean = (600 + 900 + 1200) / 3;
    expect(result).toBeGreaterThanOrEqual(mean);
    expect(result).toBeLessThanOrEqual(1200);
  });
});

describe('detectOutlier', () => {
  it('detects an obvious outlier', () => {
    // 4 people at ~600s, one person at 3000s
    const times = [600, 620, 580, 610, 3000];
    const idx = detectOutlier(times);
    expect(idx).toBe(4);
  });

  it('returns null when no outlier exists', () => {
    const times = [600, 650, 620, 610];
    expect(detectOutlier(times)).toBeNull();
  });

  it('returns null for fewer than 3 values', () => {
    expect(detectOutlier([600, 900])).toBeNull();
  });

  it('returns null for identical values', () => {
    expect(detectOutlier([600, 600, 600])).toBeNull();
  });
});
