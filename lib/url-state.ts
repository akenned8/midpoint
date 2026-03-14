// Encode/decode SessionState to/from URL using lz-string
import type { SessionState } from '@/types';

// TODO: Compress SessionState to URL-safe string using lz-string
export function encodeState(_state: SessionState): string {
  return '';
}

// TODO: Decompress URL-safe string back to SessionState
export function decodeState(_encoded: string): SessionState | null {
  return null;
}
