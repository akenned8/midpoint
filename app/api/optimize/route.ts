// POST — Full optimization pipeline endpoint
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { optimize } from '@/lib/optimizer';
import type { Person, ObjectiveType, Hotspot } from '@/types';

interface OptimizeRequest {
  people: Person[];
  objective: ObjectiveType;
  alpha: number;
  departureTime: string;
}

export async function POST(request: Request) {
  let body: OptimizeRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { people, objective, alpha, departureTime } = body;
  if (!people?.length || people.length < 2) {
    return NextResponse.json({ error: 'At least 2 people required' }, { status: 400 });
  }
  if (people.length > 6) {
    return NextResponse.json({ error: 'Maximum 6 people' }, { status: 400 });
  }

  // Load hotspots
  let hotspots: Hotspot[] = [];
  try {
    hotspots = (await import('@/data/hotspots-nyc.json')).default as Hotspot[];
  } catch {
    // Hotspot corpus not built yet — will use empty array
  }

  if (hotspots.length === 0) {
    return NextResponse.json(
      { error: 'Hotspot corpus not available', rankings: [], venues: [] },
      { status: 200 }
    );
  }

  // Determine base URL for internal API calls
  const headersList = await headers();
  const host = headersList.get('host') ?? 'localhost:3000';
  const protocol = headersList.get('x-forwarded-proto') ?? 'http';
  const baseUrl = `${protocol}://${host}`;

  try {
    const result = await optimize({
      people,
      hotspots,
      objective,
      alpha,
      departureTime,
      baseUrl,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('Optimize error:', err);
    return NextResponse.json({ error: 'Optimization failed' }, { status: 500 });
  }
}
