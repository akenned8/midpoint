// POST — Google Places Nearby Search (New) proxy + Upstash cache
import { NextResponse } from 'next/server';

export async function POST() {
  // TODO: Validate request body (lat, lng, radius, types)
  // TODO: Check Upstash cache
  // TODO: Call Google Places API (New) Nearby Search
  // TODO: Cache results and return venue list
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
