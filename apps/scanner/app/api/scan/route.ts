import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  if (process.env.BROWSER_DEMO !== 'true') return NextResponse.json({ error: 'demo_disabled' }, { status: 503 });
  const key = process.env.SCANNER_API_KEY;
  if (!key) return NextResponse.json({ error: 'scanner_key_missing' }, { status: 503 });
  const body = await request.json() as { eventId?: string; known?: boolean };
  if (!body.eventId || !/^[a-f0-9-]{36}$/.test(body.eventId)) return NextResponse.json({ error: 'invalid_event_id' }, { status: 400 });
  const imageBase64 = Buffer.from(body.known ? 'fixture-face-convidado-e2e' : 'fixture-face-desconhecido').toString('base64');
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const result = await fetch(`${base}/v1/events/${body.eventId}/scan`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ imageBase64 }), cache: 'no-store',
  });
  return new NextResponse(await result.text(), { status: result.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
