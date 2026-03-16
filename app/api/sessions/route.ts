// POST — Create a new collaborative session
import { NextResponse } from 'next/server';
import { createSession } from '@/lib/sessions';
import type { Person, ObjectiveType } from '@/types';

interface CreateSessionBody {
  people: Person[];
  objective?: ObjectiveType;
  alpha?: number;
  departureTime?: string;
}

export async function POST(request: Request) {
  let body: CreateSessionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.people || !Array.isArray(body.people) || body.people.length < 2) {
    return NextResponse.json({ error: 'At least 2 people required' }, { status: 400 });
  }

  try {
    const session = await createSession(
      body.people,
      body.objective ?? 'blended',
      body.alpha ?? 0.7,
      body.departureTime ?? 'now',
    );

    return NextResponse.json({ id: session.id, session });
  } catch (err) {
    console.error('Failed to create session:', err);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
