// POST — Google Places Nearby Search (New) proxy + Upstash cache
import { NextResponse } from 'next/server';
import { getCached, setCached, venueCacheKey } from '@/lib/cache';

interface VenuesRequest {
  locations: { lat: number; lng: number }[];
  radius?: number;       // meters, default 400
  types?: string[];      // e.g. ['restaurant', 'bar', 'cafe']
  maxPerLocation?: number; // default 10
}

interface PlaceResult {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  types: string[];
  priceLevel?: number;
}

const PLACES_API_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const VENUE_TTL = 24 * 60 * 60; // 24 hours

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  let body: VenuesRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { locations, radius = 400, types, maxPerLocation = 10 } = body;
  if (!locations?.length) {
    return NextResponse.json({ error: 'locations required' }, { status: 400 });
  }

  const allVenues: PlaceResult[] = [];
  const seenPlaceIds = new Set<string>();

  for (const loc of locations) {
    const cacheKey = venueCacheKey(loc.lat, loc.lng, radius);
    const cached = await getCached<PlaceResult[]>(cacheKey);

    if (cached) {
      for (const v of cached) {
        if (!seenPlaceIds.has(v.placeId)) {
          seenPlaceIds.add(v.placeId);
          allVenues.push(v);
        }
      }
      continue;
    }

    // Build the Places API (New) request
    const requestBody: Record<string, unknown> = {
      locationRestriction: {
        circle: {
          center: { latitude: loc.lat, longitude: loc.lng },
          radius,
        },
      },
      maxResultCount: maxPerLocation,
    };

    if (types?.length) {
      requestBody.includedTypes = types;
    } else {
      // Default: food and drink venues
      requestBody.includedTypes = ['restaurant', 'bar', 'cafe'];
    }

    try {
      const response = await fetch(PLACES_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.location,places.rating,' +
            'places.userRatingCount,places.types,places.priceLevel',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Places API error:', response.status, errText);
        continue;
      }

      const data = await response.json();
      const places: PlaceResult[] = (data.places ?? []).map(
        (p: Record<string, unknown>) => {
          const location = p.location as { latitude: number; longitude: number } | undefined;
          const displayName = p.displayName as { text: string } | undefined;
          return {
            placeId: p.id as string,
            name: displayName?.text ?? 'Unknown',
            lat: location?.latitude ?? 0,
            lng: location?.longitude ?? 0,
            rating: (p.rating as number) ?? 0,
            reviewCount: (p.userRatingCount as number) ?? 0,
            types: (p.types as string[]) ?? [],
            priceLevel: parsePriceLevel(p.priceLevel as string | undefined),
          };
        }
      );

      // Cache raw results for this location
      setCached(cacheKey, places, VENUE_TTL); // fire and forget

      for (const v of places) {
        if (!seenPlaceIds.has(v.placeId)) {
          seenPlaceIds.add(v.placeId);
          allVenues.push(v);
        }
      }
    } catch (err) {
      console.error('Places API fetch error:', err);
    }
  }

  // Score and sort: proximity is handled by the API radius, so rank by quality
  // Composite: rating × 0.6 + log(reviewCount+1) × 0.4
  const scored = allVenues.map((v) => ({
    ...v,
    compositeScore: v.rating * 0.6 + Math.log(v.reviewCount + 1) * 0.4,
  }));
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  return NextResponse.json({
    venues: scored.map(({ compositeScore: _, ...v }) => v),
    count: scored.length,
  });
}

function parsePriceLevel(level: string | undefined): number | undefined {
  if (!level) return undefined;
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return map[level];
}
