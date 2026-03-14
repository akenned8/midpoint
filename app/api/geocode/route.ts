// GET — Google Places Autocomplete + Geocoding proxy
import { NextResponse } from 'next/server';

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
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error('Place Details error:', res.status, await res.text());
        return NextResponse.json({ error: 'Place details failed' }, { status: res.status });
      }
      const data = await res.json();
      if (data.status !== 'OK') {
        console.error('Place Details status:', data.status, data.error_message);

        // Try Geocoding API as fallback
        return await geocodeFallback(placeId, apiKey);
      }
      const loc = data.result?.geometry?.location;
      return NextResponse.json({ lat: loc?.lat ?? null, lng: loc?.lng ?? null });
    } catch (err) {
      console.error('Place Details error:', err);
      return NextResponse.json({ error: 'Place details error' }, { status: 502 });
    }
  }

  // Autocomplete — try Places Autocomplete, fall back to Geocoding API
  if (query && query.length >= 2) {
    // Try Places Autocomplete first
    const suggestions = await tryPlacesAutocomplete(query, apiKey);
    if (suggestions.length > 0) {
      return NextResponse.json({ suggestions });
    }

    // Fallback: use Geocoding API for direct address lookup
    const geocodeResults = await tryGeocodingApi(query, apiKey);
    if (geocodeResults.length > 0) {
      return NextResponse.json({ suggestions: geocodeResults });
    }

    return NextResponse.json({ suggestions: [] });
  }

  return NextResponse.json({ suggestions: [] });
}

async function tryPlacesAutocomplete(
  query: string,
  apiKey: string
): Promise<{ placeId: string; description: string; mainText: string; secondaryText: string }[]> {
  try {
    // Try the new API first
    const newRes = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
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
            radius: 50000,
          },
        },
      }),
    });

    if (newRes.ok) {
      const data = await newRes.json();
      const results = (data.suggestions ?? [])
        .filter((s: Record<string, unknown>) => s.placePrediction)
        .slice(0, 5)
        .map((s: Record<string, unknown>) => {
          const prediction = s.placePrediction as Record<string, unknown>;
          const text = prediction.text as { text: string } | undefined;
          const sf = prediction.structuredFormat as {
            mainText?: { text: string };
            secondaryText?: { text: string };
          } | undefined;
          return {
            placeId: prediction.placeId as string,
            description: text?.text ?? 'Unknown',
            mainText: sf?.mainText?.text ?? '',
            secondaryText: sf?.secondaryText?.text ?? '',
          };
        });
      if (results.length > 0) return results;
    }

    // Fall back to legacy autocomplete
    const legacyUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&location=40.74%2C-73.98&radius=50000&key=${apiKey}`;
    const legacyRes = await fetch(legacyUrl);
    if (legacyRes.ok) {
      const data = await legacyRes.json();
      if (data.status === 'OK' && data.predictions?.length > 0) {
        return data.predictions.slice(0, 5).map((p: Record<string, unknown>) => ({
          placeId: p.place_id as string,
          description: p.description as string,
          mainText: (p.structured_formatting as Record<string, string>)?.main_text ?? '',
          secondaryText: (p.structured_formatting as Record<string, string>)?.secondary_text ?? '',
        }));
      }
      if (data.status !== 'OK') {
        console.error('Legacy autocomplete status:', data.status, data.error_message);
      }
    }
  } catch (err) {
    console.error('Autocomplete error:', err);
  }
  return [];
}

async function tryGeocodingApi(
  query: string,
  apiKey: string
): Promise<{ placeId: string; description: string; mainText: string; secondaryText: string }[]> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&bounds=40.49,-74.26|40.92,-73.70&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    if (data.status !== 'OK') {
      console.error('Geocoding status:', data.status, data.error_message);
      return [];
    }

    return (data.results ?? []).slice(0, 5).map((r: Record<string, unknown>) => ({
      placeId: r.place_id as string,
      description: r.formatted_address as string,
      mainText: r.formatted_address as string,
      secondaryText: '',
    }));
  } catch (err) {
    console.error('Geocoding API error:', err);
    return [];
  }
}

async function geocodeFallback(placeId: string, apiKey: string) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeId)}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ lat: null, lng: null });

    const data = await res.json();
    if (data.status === 'OK' && data.results?.[0]) {
      const loc = data.results[0].geometry?.location;
      return NextResponse.json({ lat: loc?.lat ?? null, lng: loc?.lng ?? null });
    }
    console.error('Geocode fallback status:', data.status, data.error_message);
    return NextResponse.json({ lat: null, lng: null });
  } catch {
    return NextResponse.json({ lat: null, lng: null });
  }
}
