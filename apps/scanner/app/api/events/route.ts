import { NextRequest, NextResponse } from 'next/server';
export async function GET(request: NextRequest) {
  const token = request.cookies.get('bf_session')?.value;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const response = await fetch(`${base}/v1/events`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  return new NextResponse(await response.text(), { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
