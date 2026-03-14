// POST — Google Routes API computeRouteMatrix proxy + Upstash cache
import { NextResponse } from 'next/server';
import type { TransportMode } from '@/types';
import {
  getCached,
  setCached,
  getTTL,
  travelTimeCacheKey,
} from '@/lib/cache';

interface Origin {
  lat: number;
  lng: number;
  mode: TransportMode;
}

interface Destination {
  lat: number;
  lng: number;
}

interface TimesRequest {
  origins: Origin[];
  destinations: Destination[];
  departureTime: string; // ISO8601 or 'now'
}

// Google Routes API travel mode mapping
const GOOGLE_TRAVEL_MODE: Record<TransportMode, string> = {
  transit: 'TRANSIT',
  driving: 'DRIVE',
  walking: 'WALK',
  cycling: 'BICYCLE',
};

// Google Routes API computeRouteMatrix endpoint
const ROUTES_API_URL =
  'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  let body: TimesRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { origins, destinations, departureTime } = body;
  if (!origins?.length || !destinations?.length) {
    return NextResponse.json({ error: 'origins and destinations required' }, { status: 400 });
  }

  // Validate element count (transit limit: 100)
  const totalElements = origins.length * destinations.length;
  if (totalElements > 100) {
    return NextResponse.json(
      { error: `Element count ${totalElements} exceeds 100-element limit` },
      { status: 400 }
    );
  }

  // Check cache for each origin×destination pair
  const results: (number | null)[][] = Array.from({ length: origins.length }, () =>
    Array(destinations.length).fill(null)
  );

  const uncached: { oi: number; di: number; mode: TransportMode }[] = [];

  for (let oi = 0; oi < origins.length; oi++) {
    for (let di = 0; di < destinations.length; di++) {
      const o = origins[oi];
      const d = destinations[di];
      const key = travelTimeCacheKey(o.mode, o.lat, o.lng, d.lat, d.lng, departureTime);
      const cached = await getCached<number>(key);
      if (cached !== null) {
        results[oi][di] = cached;
      } else {
        uncached.push({ oi, di, mode: o.mode });
      }
    }
  }

  // If all cached, return early
  if (uncached.length === 0) {
    return NextResponse.json({ matrix: results, cached: true });
  }

  // Group uncached by mode (each mode needs a separate API call)
  const byMode = new Map<TransportMode, { oi: number; di: number }[]>();
  for (const u of uncached) {
    const group = byMode.get(u.mode) ?? [];
    group.push({ oi: u.oi, di: u.di });
    byMode.set(u.mode, group);
  }

  // Make API calls per mode
  for (const [mode, pairs] of byMode) {
    // Collect unique origin and destination indices for this mode
    const originIndices = [...new Set(pairs.map((p) => p.oi))];
    const destIndices = [...new Set(pairs.map((p) => p.di))];

    const routeMatrixOrigins = originIndices.map((oi) => ({
      waypoint: {
        location: {
          latLng: { latitude: origins[oi].lat, longitude: origins[oi].lng },
        },
      },
    }));

    const routeMatrixDestinations = destIndices.map((di) => ({
      waypoint: {
        location: {
          latLng: { latitude: destinations[di].lat, longitude: destinations[di].lng },
        },
      },
    }));

    const requestBody: Record<string, unknown> = {
      origins: routeMatrixOrigins,
      destinations: routeMatrixDestinations,
      travelMode: GOOGLE_TRAVEL_MODE[mode],
    };

    // Add departure time for modes that support it
    if (mode === 'transit' || mode === 'driving') {
      requestBody.departureTime =
        departureTime === 'now'
          ? new Date().toISOString()
          : departureTime;
    }

    if (mode === 'transit') {
      requestBody.transitPreferences = { routingPreference: 'FEWER_TRANSFERS' };
    }

    try {
      const response = await fetch(ROUTES_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'originIndex,destinationIndex,duration,distanceMeters,status,condition',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Routes API error (${mode}):`, response.status, errText);
        continue; // Skip this mode, leave those cells as null
      }

      const data = await response.json();

      // data is an array of route matrix elements
      if (Array.isArray(data)) {
        for (const element of data) {
          if (element.status?.code && element.status.code !== 0) continue;

          const localOi = element.originIndex ?? 0;
          const localDi = element.destinationIndex ?? 0;
          const globalOi = originIndices[localOi];
          const globalDi = destIndices[localDi];

          // Duration comes as "123s" string
          const durationStr: string = element.duration ?? '0s';
          const seconds = parseInt(durationStr.replace('s', ''), 10);

          results[globalOi][globalDi] = seconds;

          // Cache the result
          const o = origins[globalOi];
          const d = destinations[globalDi];
          const key = travelTimeCacheKey(o.mode, o.lat, o.lng, d.lat, d.lng, departureTime);
          setCached(key, seconds, getTTL(mode)); // fire and forget
        }
      }
    } catch (err) {
      console.error(`Routes API fetch error (${mode}):`, err);
    }
  }

  return NextResponse.json({ matrix: results, cached: false });
}
