export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { accountExists, getAccountLocation } from '../../../../../lib/accountMemory';
import { requireUser } from '../../../../../lib/auth';
import {
  buildIPhoneShortcutLaunchUrl,
  CONTACT_IMPORT_SOURCE,
  createContactImportToken,
  getContactImportExpiry,
  getIPhoneShortcutConfig,
  hashContactImportToken,
} from '../../../../../lib/contactImport';
import { requireOrganizationContext } from '../../../../../lib/organizations';
import { prisma } from '../../../../../lib/prisma';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const input = await request.json().catch(() => null) as { accountId?: unknown; accountType?: unknown } | null;
  const location = getAccountLocation(String(input?.accountType ?? ''), String(input?.accountId ?? ''));
  if (!location || !(await accountExists(prisma, location))) {
    return Response.json({ error: 'Account not found.' }, { status: 404 });
  }

  const accountId = location.accountType === 'AGENCY' ? location.agencyId : location.wholesaleAccountId;
  const returnPath = location.accountType === 'AGENCY' ? `/agencies/${accountId}` : `/wholesale/${accountId}`;
  const state = createContactImportToken();
  const now = new Date();
  await prisma.contactImportSession.deleteMany({
    where: { userId: user.id, OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null }, createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }] },
  });
  await prisma.contactImportSession.create({
    data: {
      tokenHash: hashContactImportToken(state),
      userId: user.id,
      organizationId,
      source: CONTACT_IMPORT_SOURCE,
      accountType: location.accountType,
      accountId,
      returnPath,
      expiresAt: getContactImportExpiry(now),
    },
  });

  const config = getIPhoneShortcutConfig();
  const reviewUrl = new URL('/contact-import/review', request.url);
  reviewUrl.searchParams.set('state', state);
  return Response.json({
    launchUrl: buildIPhoneShortcutLaunchUrl({ state, reviewUrl: reviewUrl.toString(), requiredShortcutVersion: config.version }),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
