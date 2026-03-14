// Encode/decode SessionState to/from URL using lz-string
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { SessionState } from '@/types';

export function encodeState(state: SessionState): string {
  const json = JSON.stringify(state);
  return compressToEncodedURIComponent(json);
}

export function decodeState(encoded: string): SessionState | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json) as SessionState;
    // Basic validation
    if (!Array.isArray(parsed.people) || typeof parsed.alpha !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
