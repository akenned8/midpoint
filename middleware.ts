// Protect all routes except /login and /api/auth with a passphrase cookie
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes always public: login, the auth endpoint, shared session pages, and
// every API the shared-session page needs to call. Shared sessions handle
// their own per-session access code separately from the global passphrase.
const PUBLIC_PATHS = [
  '/login',
  '/api/auth',
  '/s/',
  '/api/sessions',
  '/api/optimize',
  '/api/directions',
  '/api/isochrones',
  '/api/geocode',
  '/api/venues',
  '/api/times',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get('midpoint_access')?.value;
  const expected = process.env.ACCESS_CODE;

  // If no access code is configured, allow all traffic (dev mode)
  if (!expected) return NextResponse.next();

  if (token !== expected) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
