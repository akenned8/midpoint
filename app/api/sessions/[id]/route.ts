// GET — Fetch session state (used for polling)
// PATCH — Update a person or session settings or store results
import { NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/sessions';
import type { Session, SessionResults } from '@/lib/sessions';
import type { Person, ObjectiveType } from '@/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json(session);
}

interface PatchBody {
  // Update a specific person by index
  personIndex?: number;
  person?: Partial<Person>;

  // Update session settings
  objective?: ObjectiveType;
  alpha?: number;
  departureTime?: string;

  // Store optimization results
  results?: SessionResults;

  // Clear results (when someone changes their location)
  clearResults?: boolean;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Update a specific person
  if (body.personIndex != null && body.person) {
    const idx = body.personIndex;
    if (idx < 0 || idx >= session.people.length) {
      return NextResponse.json({ error: 'Invalid person index' }, { status: 400 });
    }
    session.people[idx] = { ...session.people[idx], ...body.person };
    // Clear stale results when a person's location changes
    if (body.person.lat != null || body.person.lng != null || body.person.mode != null) {
      session.results = null;
    }
  }

  // Update session-level settings
  if (body.objective != null) session.objective = body.objective;
  if (body.alpha != null) session.alpha = body.alpha;
  if (body.departureTime != null) session.departureTime = body.departureTime;

  // Store results
  if (body.results) {
    session.results = body.results;
  }

  if (body.clearResults) {
    session.results = null;
  }

  try {
    await updateSession(session);
    return NextResponse.json(session);
  } catch (err) {
    console.error('Failed to update session:', err);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
