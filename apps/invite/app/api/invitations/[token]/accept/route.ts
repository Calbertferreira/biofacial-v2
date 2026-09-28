import { NextRequest, NextResponse } from 'next/server';

export async function POST(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  if (process.env.BROWSER_DEMO !== 'true') return NextResponse.json({ error: 'demo_disabled' }, { status: 503 });
  const { token } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  const imageBase64 = Buffer.from('fixture-face-convidado-e2e').toString('base64');
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const result = await fetch(`${base}/v1/invitations/${token}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ consent: true, imageBase64 }), cache: 'no-store',
  });
  return new NextResponse(await result.text(), { status: result.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
