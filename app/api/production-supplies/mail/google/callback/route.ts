import { NextResponse } from 'next/server';
import { requireSupplyMailboxOwner } from '../../../../../../lib/productionSupplies/access';
import { finishSupplyMailboxOAuth } from '../../../../../../lib/productionSupplies/mail';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const { user, context } = await requireSupplyMailboxOwner();
  const url = new URL(request.url), code = url.searchParams.get('code'), state = url.searchParams.get('state');
  let status = 'connection-failed';
  if (code && state && !url.searchParams.get('error')) {
    try { await finishSupplyMailboxOAuth(context.organizationId, user, state, code); status = 'connected'; } catch { /* No tokens, provider bodies or mailbox content in logs. */ }
  }
  return NextResponse.redirect(new URL(`/production-supplies/settings?status=${status}`, request.url));
}
