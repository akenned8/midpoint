// POST — Fetch route polylines for each person to a destination
// Uses Mapbox Directions for driving/walking/cycling, Google Routes for transit
// Transit routes include step-by-step segments (walk, subway line, etc.)
import { NextResponse } from 'next/server';
import type { TransportMode } from '@/types';

interface DirectionsRequest {
  routes: {
    personId: string;
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    mode: TransportMode;
    color: string;
  }[];
  departureTime: string;
}

export interface RouteSegment {
  travelMode: 'WALK' | 'TRANSIT';
  durationSeconds: number;
  polyline: [number, number][];
  transitLineName?: string;
  transitLineColor?: string;
  transitLineShortName?: string;
}

interface RouteResult {
  personId: string;
  color: string;
  durationSeconds: number;
  geometry: GeoJSON.Feature<GeoJSON.LineString>;
  segments?: RouteSegment[];
}

const MAPBOX_PROFILES: Record<string, string> = {
  driving: 'mapbox/driving',
  walking: 'mapbox/walking',
  cycling: 'mapbox/cycling',
};

export async function POST(request: Request) {
  const mapboxToken = process.env.MAPBOX_SECRET_TOKEN;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;

  let body: DirectionsRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const results: RouteResult[] = [];

  for (const r of body.routes) {
    if (r.mode === 'transit') {
      // Use Google Routes API for transit (Mapbox doesn't support transit)
      if (!googleKey) continue;
      const route = await fetchGoogleRoute(r, body.departureTime, googleKey);
      if (route) results.push(route);
    } else {
      // Use Mapbox Directions for driving/walking/cycling
      if (!mapboxToken) continue;
      const route = await fetchMapboxRoute(r, mapboxToken);
      if (route) results.push(route);
    }
  }

  return NextResponse.json({ routes: results });
}

async function fetchMapboxRoute(
  r: DirectionsRequest['routes'][0],
  token: string,
): Promise<RouteResult | null> {
  const profile = MAPBOX_PROFILES[r.mode];
  if (!profile) return null;

  const url = `https://api.mapbox.com/directions/v5/${profile}/${r.originLng},${r.originLat};${r.destLng},${r.destLat}?geometries=geojson&overview=full&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;

    return {
      personId: r.personId,
      color: r.color,
      durationSeconds: Math.round(route.duration),
      geometry: {
        type: 'Feature',
        properties: { personId: r.personId, color: r.color, duration: Math.round(route.duration) },
        geometry: route.geometry,
      },
    };
  } catch {
    return null;
  }
}

async function fetchGoogleRoute(
  r: DirectionsRequest['routes'][0],
  departureTime: string,
  apiKey: string,
): Promise<RouteResult | null> {
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'routes.duration',
          'routes.polyline.encodedPolyline',
          'routes.legs.steps.travelMode',
          'routes.legs.steps.staticDuration',
          'routes.legs.steps.polyline.encodedPolyline',
          'routes.legs.steps.transitDetails.transitLine.name',
          'routes.legs.steps.transitDetails.transitLine.nameShort',
          'routes.legs.steps.transitDetails.transitLine.color',
          'routes.legs.steps.transitDetails.transitLine.textColor',
        ].join(','),
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: r.originLat, longitude: r.originLng } } },
        destination: { location: { latLng: { latitude: r.destLat, longitude: r.destLng } } },
        travelMode: 'TRANSIT',
        departureTime: departureTime === 'now' ? new Date().toISOString() : departureTime,
        transitPreferences: { routingPreference: 'FEWER_TRANSFERS' },
      }),
    });

    if (!res.ok) {
      return straightLineRoute(r);
    }

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route?.polyline?.encodedPolyline) {
      return straightLineRoute(r);
    }

    const coords = decodePolyline(route.polyline.encodedPolyline);
    const durationStr: string = route.duration ?? '0s';
    const seconds = parseInt(durationStr.replace('s', ''), 10);

    // Extract step-by-step segments for transit visualization
    const segments: RouteSegment[] = [];
    const legs = route.legs;
    if (Array.isArray(legs)) {
      for (const leg of legs) {
        const steps = leg.steps;
        if (!Array.isArray(steps)) continue;
        for (const step of steps) {
          const stepPolyline = step.polyline?.encodedPolyline;
          if (!stepPolyline) continue;
          const stepCoords = decodePolyline(stepPolyline);
          const stepDurStr: string = step.staticDuration ?? '0s';
          const stepSeconds = parseInt(stepDurStr.replace('s', ''), 10);

          const segment: RouteSegment = {
            travelMode: step.travelMode === 'TRANSIT' ? 'TRANSIT' : 'WALK',
            durationSeconds: stepSeconds,
            polyline: stepCoords,
          };

          if (step.travelMode === 'TRANSIT' && step.transitDetails?.transitLine) {
            const line = step.transitDetails.transitLine;
            segment.transitLineName = line.name ?? undefined;
            segment.transitLineColor = line.color ?? undefined;
            segment.transitLineShortName = line.nameShort ?? undefined;
          }

          segments.push(segment);
        }
      }
    }

    return {
      personId: r.personId,
      color: r.color,
      durationSeconds: seconds,
      geometry: {
        type: 'Feature',
        properties: { personId: r.personId, color: r.color, duration: seconds },
        geometry: { type: 'LineString', coordinates: coords },
      },
      segments: segments.length > 0 ? segments : undefined,
    };
  } catch {
    return straightLineRoute(r);
  }
}

function straightLineRoute(r: DirectionsRequest['routes'][0]): RouteResult {
  return {
    personId: r.personId,
    color: r.color,
    durationSeconds: 0,
    geometry: {
      type: 'Feature',
      properties: { personId: r.personId, color: r.color, duration: 0 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [r.originLng, r.originLat],
          [r.destLng, r.destLat],
        ],
      },
    },
  };
}

// Decode Google's encoded polyline format
function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / 1e5, lat / 1e5]);
  }

  return coords;
}
