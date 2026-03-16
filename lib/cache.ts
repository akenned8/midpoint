// Upstash Redis wrapper with TTL helpers and time-bucketed keys
import { Redis } from '@upstash/redis';
import type { TransportMode, LearningObservation } from '@/types';
import { geohash } from '@/lib/geo';

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    if (!url || !token) return null;
    redis = new Redis({ url, token });
  }
  return redis;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    const value = await client.get<T>(key);
    return value ?? null;
  } catch {
    return null;
  }
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await client.set(key, value, { ex: ttlSeconds });
  } catch {
    // Swallow cache write errors — non-critical
  }
}

// TTLs per mode
const MODE_TTLS: Record<TransportMode, number> = {
  transit: 15 * 60,    // 15 min
  driving: 20 * 60,    // 20 min
  walking: 6 * 60 * 60, // 6 hr
  cycling: 6 * 60 * 60, // 6 hr
};

export function getTTL(mode: TransportMode): number {
  return MODE_TTLS[mode];
}

// Time bucket sizes in milliseconds
const BUCKET_MS: Record<TransportMode, number> = {
  transit: 30 * 60 * 1000,  // 30 min
  driving: 60 * 60 * 1000,  // 1 hr
  walking: 0,                // no time dimension
  cycling: 0,                // no time dimension
};

export function timeBucketKey(timestamp: string, mode: TransportMode): string {
  const bucketMs = BUCKET_MS[mode];
  if (bucketMs === 0) return 'any';
  const ms = timestamp === 'now' ? Date.now() : new Date(timestamp).getTime();
  const bucket = Math.floor(ms / bucketMs) * bucketMs;
  return String(bucket);
}

// Build a full cache key for a travel time query
export function travelTimeCacheKey(
  mode: TransportMode,
  originLat: number, originLng: number,
  destLat: number, destLng: number,
  timestamp: string
): string {
  const originHash = geohash(originLat, originLng, 7);
  const destHash = geohash(destLat, destLng, 7);
  const timeBucket = timeBucketKey(timestamp, mode);
  return `tt:${mode}:${originHash}:${destHash}:${timeBucket}`;
}

// Build a cache key for venue searches
export function venueCacheKey(lat: number, lng: number, radius: number): string {
  const hash = geohash(lat, lng, 6);
  return `venues:${hash}:${radius}`;
}

// ─── Learning cache ───

const LEARNING_TTL = 7 * 24 * 60 * 60; // 7 days
const MAX_OBSERVATIONS = 20;

export function learningCacheKey(
  mode: TransportMode, originZoneId: string, destZoneId: string
): string {
  return `learn:${mode}:${originZoneId}:${destZoneId}`;
}

export async function getLearningObservations(
  mode: TransportMode, originZoneId: string, destZoneId: string
): Promise<LearningObservation[] | null> {
  const key = learningCacheKey(mode, originZoneId, destZoneId);
  return getCached<LearningObservation[]>(key);
}

export async function addLearningObservation(
  mode: TransportMode, originZoneId: string, destZoneId: string, seconds: number
): Promise<void> {
  const key = learningCacheKey(mode, originZoneId, destZoneId);
  try {
    const existing = await getCached<LearningObservation[]>(key);
    const observations = existing ?? [];
    observations.push({ seconds, timestamp: Math.floor(Date.now() / 1000) });
    // Cap at MAX_OBSERVATIONS, evict oldest
    if (observations.length > MAX_OBSERVATIONS) {
      observations.splice(0, observations.length - MAX_OBSERVATIONS);
    }
    await setCached(key, observations, LEARNING_TTL);
  } catch {
    // Fire-and-forget
  }
}

export function medianOfObservations(observations: LearningObservation[]): number {
  if (observations.length === 0) return 0;
  const sorted = observations.map((o) => o.seconds).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Build a cache key for isochrone queries
export function isochroneCacheKey(
  lat: number, lng: number,
  mode: string,
  minutes: number
): string {
  const hash = geohash(lat, lng, 7);
  return `iso:${mode}:${hash}:${minutes}`;
}
