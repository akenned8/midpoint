// GET — Fetch session state (used for polling)
// PATCH — Update a person or session settings or store results
import { NextResponse } from 'next/server';
import { getSession, updateSession, normalizeCode } from '@/lib/sessions';
import type { SessionResults } from '@/lib/sessions';
import type { Person, ObjectiveType } from '@/types';

// Pull a session-unlock code from a request — header preferred, query fallback
function extractCode(request: Request): string {
  const header = request.headers.get('x-session-code');
  if (header) return normalizeCode(header);
  const url = new URL(request.url);
  return normalizeCode(url.searchParams.get('code'));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.accessCode) {
    const provided = extractCode(request);
    if (provided !== session.accessCode) {
      return NextResponse.json(
        { locked: true, peopleCount: session.people.length },
        { status: 401 },
      );
    }
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
  if (session.accessCode) {
    const provided = extractCode(request);
    if (provided !== session.accessCode) {
      return NextResponse.json({ locked: true }, { status: 401 });
    }
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
