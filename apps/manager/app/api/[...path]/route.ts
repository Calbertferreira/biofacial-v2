import { NextRequest, NextResponse } from 'next/server';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (process.env.BROWSER_DEMO !== 'true') return NextResponse.json({ error: 'demo_disabled' }, { status: 503 });
  const key = process.env.ADMIN_API_KEY;
  if (!key) return NextResponse.json({ error: 'admin_key_missing' }, { status: 503 });
  const { path } = await context.params;
  const route = path.join('/');
  const allowed = (request.method === 'POST' && (route === 'events' || /^events\/[a-f0-9-]+\/(guests|activate)$/.test(route)))
    || (request.method === 'GET' && /^events\/[a-f0-9-]+\/access-events$/.test(route));
  if (!allowed) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const body = request.method === 'POST' ? await request.text() : '';
  const result = await fetch(`${base}/v1/${route}`, {
    method: request.method,
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body || undefined,
    cache: 'no-store',
  });
  return new NextResponse(await result.text(), { status: result.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export const GET = proxy;
export const POST = proxy;
