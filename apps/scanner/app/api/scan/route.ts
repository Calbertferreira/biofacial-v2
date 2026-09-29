import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || new URL(origin).host !== request.headers.get('host')) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  const token = request.cookies.get('bf_session')?.value;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json() as { eventId?: string; imageBase64?: string; direction?: string };
  if (!body.eventId || !/^[a-f0-9-]{36}$/.test(body.eventId) || !body.imageBase64 || body.imageBase64.length > 2_000_000 || !['entry', 'exit'].includes(body.direction ?? '')) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const result = await fetch(`${base}/v1/events/${body.eventId}/scan`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ imageBase64: body.imageBase64, direction: body.direction }), cache: 'no-store',
  });
  return new NextResponse(await result.text(), { status: result.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
