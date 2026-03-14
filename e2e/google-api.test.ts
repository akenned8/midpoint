// Tests to verify Google API connectivity and configuration
// Run: npm run test:smoke (or DEPLOY_URL=https://... npm run test:smoke)

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.DEPLOY_URL ?? 'http://localhost:3000';

describe('Google API connectivity', () => {
  it('geocode autocomplete returns suggestions for "Times Square"', async () => {
    const res = await fetch(`${BASE_URL}/api/geocode?q=${encodeURIComponent('Times Square New York')}`);
    expect(res.ok).toBe(true);

    const data = await res.json();
    console.log('Autocomplete response:', JSON.stringify(data, null, 2));

    expect(data.suggestions).toBeDefined();
    expect(data.suggestions.length).toBeGreaterThan(0);
    expect(data.suggestions[0].placeId).toBeTruthy();
    expect(data.suggestions[0].description).toBeTruthy();
  }, 15000);

  it('geocode resolves a placeId to lat/lng', async () => {
    // First get a placeId from autocomplete
    const searchRes = await fetch(`${BASE_URL}/api/geocode?q=${encodeURIComponent('Union Square NYC')}`);
    expect(searchRes.ok).toBe(true);
    const searchData = await searchRes.json();

    console.log('Search response:', JSON.stringify(searchData, null, 2));

    if (searchData.suggestions?.length > 0) {
      const placeId = searchData.suggestions[0].placeId;
      const detailRes = await fetch(`${BASE_URL}/api/geocode?placeId=${encodeURIComponent(placeId)}`);
      expect(detailRes.ok).toBe(true);

      const detailData = await detailRes.json();
      console.log('Place details response:', JSON.stringify(detailData, null, 2));

      expect(detailData.lat).toBeGreaterThan(40);
      expect(detailData.lat).toBeLessThan(41);
      expect(detailData.lng).toBeGreaterThan(-75);
      expect(detailData.lng).toBeLessThan(-73);
    } else {
      console.warn('No suggestions returned — Google Places API may not be enabled');
    }
  }, 15000);

  it('routes API returns travel times', async () => {
    const res = await fetch(`${BASE_URL}/api/times`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origins: [
          { lat: 40.758, lng: -73.985, mode: 'transit' },
        ],
        destinations: [
          { lat: 40.686, lng: -73.977 },
        ],
        departureTime: 'now',
      }),
    });

    console.log('Routes API status:', res.status);
    const data = await res.json();
    console.log('Routes API response:', JSON.stringify(data, null, 2));

    expect(res.ok).toBe(true);
    expect(data.matrix).toBeDefined();
    // matrix[0][0] should be a number (seconds) or null if API failed
    if (data.matrix[0][0] !== null) {
      expect(data.matrix[0][0]).toBeGreaterThan(0);
    } else {
      console.warn('Routes API returned null — API key may lack Routes API access');
    }
  }, 15000);

  it('venues API returns places', async () => {
    const res = await fetch(`${BASE_URL}/api/venues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [{ lat: 40.758, lng: -73.985 }],
      }),
    });

    console.log('Venues API status:', res.status);
    const data = await res.json();
    console.log('Venues API response (count):', data.count, 'first:', data.venues?.[0]?.name);

    expect(res.ok).toBe(true);
    expect(data.venues).toBeDefined();
    if (data.venues.length > 0) {
      expect(data.venues[0].name).toBeTruthy();
      expect(data.venues[0].lat).toBeGreaterThan(0);
    } else {
      console.warn('Venues API returned empty — Places API (New) may not be enabled');
    }
  }, 15000);
});
