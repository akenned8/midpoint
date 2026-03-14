// POST — Google Routes API computeRouteMatrix proxy + Upstash cache
import { NextResponse } from 'next/server';

export async function POST() {
  // TODO: Validate request body (origins, destinations, mode, departureTime)
  // TODO: Check Upstash cache with time-bucketed keys
  // TODO: Call Google Routes API computeRouteMatrix
  // TODO: Cache results and return travel time matrix
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
