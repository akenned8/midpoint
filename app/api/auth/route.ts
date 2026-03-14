// POST — Validate access code and set cookie
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const expected = process.env.ACCESS_CODE;
  if (!expected) {
    return NextResponse.json({ error: 'No access code configured' }, { status: 500 });
  }

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.code || body.code.trim() !== expected) {
    return NextResponse.json({ error: 'Wrong code' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('midpoint_access', expected, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return res;
}
