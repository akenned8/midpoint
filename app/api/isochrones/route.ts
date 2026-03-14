// POST — Mapbox Isochrone proxy (driving/walking/cycling only, no transit)
import { NextResponse } from 'next/server';

export async function POST() {
  // TODO: Validate request body (lat, lng, mode, contours_minutes)
  // TODO: Call Mapbox Isochrone API using MAPBOX_SECRET_TOKEN
  // TODO: Return GeoJSON polygon
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
