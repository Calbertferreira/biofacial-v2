import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  const { token } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  const body = await request.text();
  if (body.length > 2_500_000) return NextResponse.json({ error: 'image_too_large' }, { status: 413 });
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const result = await fetch(`${base}/v1/invitations/${token}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body, cache: 'no-store',
  });
  return new NextResponse(await result.text(), { status: result.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
