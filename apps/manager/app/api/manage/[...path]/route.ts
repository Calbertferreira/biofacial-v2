import { NextRequest, NextResponse } from 'next/server';

async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' && (!origin || new URL(origin).host !== request.headers.get('host'))) {
    return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  }
  const token = request.cookies.get('bf_session')?.value;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const route = (await context.params).path.join('/');
  const allowed = ['clients', 'users', 'events'].includes(route)
    || /^clients\/[a-f0-9-]{36}$/.test(route)
    || /^users\/[a-f0-9-]{36}$/.test(route)
    || /^events\/[a-f0-9-]{36}(\/guests|\/guests\/[a-f0-9-]{36}\/invitation-link|\/access-events|\/activate|\/finish|\/invitations\/send)?$/.test(route);
  if (!allowed) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const body = request.method === 'GET' ? '' : await request.text();
  const upstream = await fetch(`${base}/v1/${route}`, {
    method: request.method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body || undefined, cache: 'no-store',
  });
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
