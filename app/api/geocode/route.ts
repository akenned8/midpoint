// GET — Google Places Autocomplete + Place Details proxy
import { NextResponse } from 'next/server';

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const placeId = searchParams.get('placeId');

  // Place Details — resolve placeId to lat/lng
  if (placeId) {
    try {
      const res = await fetch(`${PLACE_DETAILS_URL}/${placeId}`, {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'location',
        },
      });
      if (!res.ok) {
        return NextResponse.json({ error: 'Place details failed' }, { status: res.status });
      }
      const data = await res.json();
      return NextResponse.json({
        lat: data.location?.latitude ?? null,
        lng: data.location?.longitude ?? null,
      });
    } catch {
      return NextResponse.json({ error: 'Place details error' }, { status: 502 });
    }
  }

  // Autocomplete — search for places matching query
  if (query && query.length >= 2) {
    try {
      const res = await fetch(AUTOCOMPLETE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify({
          input: query,
          locationBias: {
            circle: {
              center: { latitude: 40.74, longitude: -73.98 },
              radius: 50000, // 50km — covers NYC metro
            },
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('Autocomplete error:', res.status, errText);
        return NextResponse.json({ suggestions: [] });
      }

      const data = await res.json();
      const suggestions = (data.suggestions ?? [])
        .filter((s: Record<string, unknown>) => s.placePrediction)
        .slice(0, 5)
        .map((s: Record<string, unknown>) => {
          const prediction = s.placePrediction as Record<string, unknown>;
          const text = prediction.text as { text: string } | undefined;
          const structuredFormat = prediction.structuredFormat as {
            mainText?: { text: string };
            secondaryText?: { text: string };
          } | undefined;
          return {
            placeId: prediction.placeId as string,
            description: text?.text ?? 'Unknown',
            mainText: structuredFormat?.mainText?.text ?? '',
            secondaryText: structuredFormat?.secondaryText?.text ?? '',
          };
        });

      return NextResponse.json({ suggestions });
    } catch {
      return NextResponse.json({ suggestions: [] });
    }
  }

  return NextResponse.json({ suggestions: [] });
}
