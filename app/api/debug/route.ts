// GET — Diagnostic endpoint to test Google API connectivity
// Returns which APIs are working and which are failing
// Remove this endpoint before going to production

export async function GET() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const results: Record<string, unknown> = {
    hasApiKey: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.slice(0, 8) + '...' : null,
    tests: {},
  };

  if (!apiKey) {
    return Response.json(results);
  }

  // Test 1: Legacy Places Autocomplete
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Times+Square&location=40.74%2C-73.98&radius=50000&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    results.tests = {
      ...results.tests as object,
      legacyAutocomplete: {
        status: data.status,
        error: data.error_message ?? null,
        resultCount: data.predictions?.length ?? 0,
      },
    };
  } catch (err) {
    results.tests = { ...results.tests as object, legacyAutocomplete: { error: String(err) } };
  }

  // Test 2: Places Autocomplete (New)
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({ input: 'Times Square' }),
    });
    const data = await res.json();
    results.tests = {
      ...results.tests as object,
      newAutocomplete: {
        httpStatus: res.status,
        suggestionCount: data.suggestions?.length ?? 0,
        error: data.error?.message ?? null,
      },
    };
  } catch (err) {
    results.tests = { ...results.tests as object, newAutocomplete: { error: String(err) } };
  }

  // Test 3: Geocoding API
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=Times+Square+NYC&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    results.tests = {
      ...results.tests as object,
      geocoding: {
        status: data.status,
        error: data.error_message ?? null,
        resultCount: data.results?.length ?? 0,
      },
    };
  } catch (err) {
    results.tests = { ...results.tests as object, geocoding: { error: String(err) } };
  }

  // Test 4: Routes API
  try {
    const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration',
      },
      body: JSON.stringify({
        origins: [{ waypoint: { location: { latLng: { latitude: 40.758, longitude: -73.985 } } } }],
        destinations: [{ waypoint: { location: { latLng: { latitude: 40.686, longitude: -73.977 } } } }],
        travelMode: 'TRANSIT',
      }),
    });
    const data = await res.json();
    const isArray = Array.isArray(data);
    results.tests = {
      ...results.tests as object,
      routesApi: {
        httpStatus: res.status,
        isValidResponse: isArray,
        duration: isArray ? data[0]?.duration : null,
        error: !isArray ? data.error?.message : null,
      },
    };
  } catch (err) {
    results.tests = { ...results.tests as object, routesApi: { error: String(err) } };
  }

  // Test 5: Places Nearby Search (New)
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName',
      },
      body: JSON.stringify({
        locationRestriction: { circle: { center: { latitude: 40.758, longitude: -73.985 }, radius: 400 } },
        maxResultCount: 3,
        includedTypes: ['restaurant'],
      }),
    });
    const data = await res.json();
    results.tests = {
      ...results.tests as object,
      placesNearby: {
        httpStatus: res.status,
        placeCount: data.places?.length ?? 0,
        error: data.error?.message ?? null,
      },
    };
  } catch (err) {
    results.tests = { ...results.tests as object, placesNearby: { error: String(err) } };
  }

  return Response.json(results, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
