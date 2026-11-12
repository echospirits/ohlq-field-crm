import { NextResponse } from 'next/server';
import { requireSupplyMailboxOwner } from '../../../../../../lib/productionSupplies/access';
import { beginSupplyMailboxOAuth } from '../../../../../../lib/productionSupplies/mail';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const { user, context } = await requireSupplyMailboxOwner();
  try { return NextResponse.redirect(await beginSupplyMailboxOAuth(context.organizationId, user.id)); }
  catch { return NextResponse.redirect(new URL('/production-supplies/settings?status=oauth-not-configured', request.url)); }
}
