import { NextResponse } from 'next/server';
import { handleSupplyTrackingWebhook } from '../../../../../lib/productionSupplies/tracking';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 1024 * 1024) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > 1024 * 1024) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  try { return NextResponse.json(await handleSupplyTrackingWebhook(body, request.headers, new URL(request.url).pathname)); }
  catch (error) {
    const code = (error as { code?: string }).code;
    return NextResponse.json({ error: code === 'webhook_unauthorized' ? 'Unauthorized' : 'Tracking update could not be accepted.' }, { status: code === 'webhook_unauthorized' ? 401 : code === 'invalid_webhook' ? 400 : 503 });
  }
}
