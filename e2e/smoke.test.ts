// Smoke test: verifies the optimize pipeline returns results for 2 people
// Run against a live deployment: DEPLOY_URL=https://your-app.vercel.app npx vitest run e2e/
// Or locally: npm run dev, then npx vitest run e2e/

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.DEPLOY_URL ?? 'http://localhost:3000';

const TWO_PEOPLE_REQUEST = {
  people: [
    { id: '1', label: 'Alice', lat: 40.758, lng: -73.985, mode: 'transit', color: '#ef4444' },
    { id: '2', label: 'Bob', lat: 40.686, lng: -73.977, mode: 'transit', color: '#3b82f6' },
  ],
  objective: 'blended',
  alpha: 0.7,
  departureTime: 'now',
};

describe('optimize API smoke test', () => {
  it('returns rankings for 2 people in NYC', async () => {
    const res = await fetch(`${BASE_URL}/api/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TWO_PEOPLE_REQUEST),
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // Read the SSE stream
    const text = await res.text();
    const events = text
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.replace('data: ', '')));

    // Should have stage events and a final result
    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent).toBeDefined();

    // Must have rankings
    expect(resultEvent.rankings).toBeDefined();
    expect(resultEvent.rankings.length).toBeGreaterThan(0);

    // Rankings must have times for each person
    const topRanking = resultEvent.rankings[0];
    expect(topRanking.times).toHaveLength(2);
    expect(topRanking.times[0]).toBeGreaterThan(0);
    expect(topRanking.times[1]).toBeGreaterThan(0);
    expect(topRanking.score).toBeGreaterThan(0);

    // Must have candidateDetails with neighborhoods
    expect(resultEvent.candidateDetails).toBeDefined();
    expect(resultEvent.candidateDetails.length).toBeGreaterThan(0);
    expect(resultEvent.candidateDetails[0].neighborhood).toBeTruthy();

    // Should have stage events showing pipeline progress
    const stageEvents = events.filter((e) => e.type === 'stage');
    expect(stageEvents.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('rejects requests with fewer than 2 people', async () => {
    const res = await fetch(`${BASE_URL}/api/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...TWO_PEOPLE_REQUEST,
        people: [TWO_PEOPLE_REQUEST.people[0]],
      }),
    });

    expect(res.status).toBe(400);
  });

  it('homepage loads successfully', async () => {
    const res = await fetch(BASE_URL);
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain('Midpoint');
  });
});
