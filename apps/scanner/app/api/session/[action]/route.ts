import { NextRequest, NextResponse } from 'next/server';

async function handler(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!['login', 'logout', 'me'].includes(action)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if ((request.method === 'GET') !== (action === 'me')) return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
  const origin = request.headers.get('origin');
  if (request.method === 'POST' && (!origin || new URL(origin).host !== request.headers.get('host'))) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  const token = request.cookies.get('bf_session')?.value;
  if (action !== 'login' && !token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const upstream = await fetch(`${base}/v1/auth/${action}`, {
    method: request.method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(action === 'login' ? { 'content-type': 'application/json' } : {}) },
    body: action === 'login' ? await request.text() : undefined,
    cache: 'no-store',
  });
  const data = await upstream.json();
  const response = NextResponse.json(action === 'login' && upstream.ok ? { user: data.user } : data, { status: upstream.status });
  response.headers.set('Cache-Control', 'no-store');
  if (action === 'login' && upstream.ok) response.cookies.set('bf_session', data.accessToken, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 12 * 60 * 60 });
  if (action === 'logout' && upstream.ok) response.cookies.delete('bf_session');
  return response;
}
export const GET = handler;
export const POST = handler;
