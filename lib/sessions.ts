// Collaborative session storage backed by Upstash Redis
import { nanoid } from 'nanoid';
import { getCached, setCached } from '@/lib/cache';
import type { Person, ObjectiveType, Venue, TravelTimeResult } from '@/types';

const SESSION_TTL = 24 * 60 * 60; // 24 hours
const SESSION_ID_LENGTH = 8;

export interface Session {
  id: string;
  people: Person[];
  objective: ObjectiveType;
  alpha: number;
  departureTime: string;
  results: SessionResults | null;
  updatedAt: number; // Unix ms — used by clients to detect changes
  createdAt: number;
}

export interface SessionResults {
  rankings: TravelTimeResult[];
  venues: Venue[];
  candidateDetails: {
    hotspotId: string;
    neighborhood: string;
    borough: string;
    lat: number;
    lng: number;
  }[];
  usedHeuristic: boolean;
}

function sessionKey(id: string): string {
  return `session:${id}`;
}

export async function createSession(
  people: Person[],
  objective: ObjectiveType,
  alpha: number,
  departureTime: string,
): Promise<Session> {
  const id = nanoid(SESSION_ID_LENGTH);
  const now = Date.now();
  const session: Session = {
    id,
    people,
    objective,
    alpha,
    departureTime,
    results: null,
    updatedAt: now,
    createdAt: now,
  };
  await setCached(sessionKey(id), session, SESSION_TTL);
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  return getCached<Session>(sessionKey(id));
}

export async function updateSession(session: Session): Promise<void> {
  session.updatedAt = Date.now();
  await setCached(sessionKey(session.id), session, SESSION_TTL);
}
