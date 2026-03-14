// Objective functions for scoring candidate midpoints

export function minimax(times: number[]): number {
  return Math.max(...times);
}

export function sumOfSquares(times: number[]): number {
  return times.reduce((sum, t) => sum + t * t, 0);
}

export function blended(times: number[], alpha: number): number {
  // alpha=1 → pure fairness (minimax), alpha=0 → pure efficiency (sumOfSquares)
  const fair = minimax(times);
  const efficient = sumOfSquares(times);
  // Normalize to comparable scales: minimax is in seconds, sumOfSquares is in seconds²
  // Use mean as the efficiency metric for blending
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return alpha * fair + (1 - alpha) * mean;
}

export function detectOutlier(times: number[]): number | null {
  if (times.length < 3) return null;

  // Use modified z-score with median for robustness against outlier influence on mean/std
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  const mad = medianAbsoluteDeviation(times, median);
  if (mad === 0) return null;

  let worstIdx: number | null = null;
  let worstScore = 0;
  for (let i = 0; i < times.length; i++) {
    // Modified z-score: 0.6745 is the 0.75th quartile of the standard normal
    const modifiedZ = 0.6745 * (times[i] - median) / mad;
    // Require both statistical significance AND meaningful absolute deviation (>5 min)
    const absDeviation = times[i] - median;
    if (modifiedZ > 2 && absDeviation > 300 && modifiedZ > worstScore) {
      worstScore = modifiedZ;
      worstIdx = i;
    }
  }
  return worstIdx;
}

function medianAbsoluteDeviation(values: number[], median: number): number {
  const deviations = values.map((v) => Math.abs(v - median));
  const sorted = deviations.sort((a, b) => a - b);
  return sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
}
