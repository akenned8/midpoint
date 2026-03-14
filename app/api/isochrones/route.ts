// POST — Mapbox Isochrone proxy (driving/walking/cycling only, no transit)
import { NextResponse } from 'next/server';
import { getCached, setCached, isochroneCacheKey } from '@/lib/cache';

interface IsochroneRequest {
  lat: number;
  lng: number;
  mode: 'driving' | 'walking' | 'cycling';
  contours_minutes: number[]; // e.g. [10, 20, 30]
}

// Mapbox profile mapping
const MAPBOX_PROFILES: Record<string, string> = {
  driving: 'mapbox/driving',
  walking: 'mapbox/walking',
  cycling: 'mapbox/cycling',
};

const ISOCHRONE_TTL = 30 * 60; // 30 minutes

export async function POST(request: Request) {
  const token = process.env.MAPBOX_SECRET_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  let body: IsochroneRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { lat, lng, mode, contours_minutes } = body;

  if (!lat || !lng || !mode || !contours_minutes?.length) {
    return NextResponse.json(
      { error: 'lat, lng, mode, and contours_minutes required' },
      { status: 400 }
    );
  }

  // Validate mode is supported
  if (!(mode in MAPBOX_PROFILES)) {
    return new NextResponse(null, { status: 204 });
  }

  // Check cache (use the max contour as cache key since we request all at once)
  const maxMinutes = Math.max(...contours_minutes);
  const cacheKey = isochroneCacheKey(lat, lng, mode, maxMinutes);
  const cached = await getCached<GeoJSON.FeatureCollection>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const profile = MAPBOX_PROFILES[mode];
  const contoursParam = contours_minutes.join(',');

  const url =
    `https://api.mapbox.com/isochrone/v1/${profile}/${lng},${lat}` +
    `?contours_minutes=${contoursParam}` +
    `&polygons=true` +
    `&denoise=1` +
    `&generalize=500` +
    `&access_token=${token}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const errText = await response.text();
      console.error('Mapbox Isochrone error:', response.status, errText);
      return NextResponse.json(
        { error: 'Isochrone API error' },
        { status: response.status }
      );
    }

    const geojson = await response.json();

    // Cache the result
    setCached(cacheKey, geojson, ISOCHRONE_TTL); // fire and forget

    return NextResponse.json(geojson);
  } catch (err) {
    console.error('Mapbox Isochrone fetch error:', err);
    return NextResponse.json({ error: 'Isochrone request failed' }, { status: 502 });
  }
}
