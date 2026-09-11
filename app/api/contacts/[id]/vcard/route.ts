export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getCurrentUser } from '../../../../../lib/auth';
import { prisma } from '../../../../../lib/prisma';
import { requireOrganizationContext } from '../../../../../lib/organizations';
import { buildVCard, getVCardFilename } from '../../../../../lib/vCard';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const { organizationId } = await requireOrganizationContext(user);
  const { id } = await params;
  const contact = await prisma.locationContact.findFirst({
    where: { id, organizationId },
    select: { id: true, name: true, role: true, phone: true, email: true, notes: true, agencyId: true, wholesaleAccountId: true, updatedAt: true },
  });
  if (!contact) return Response.json({ error: 'Contact not found.' }, { status: 404 });

  const accountName = contact.agencyId
    ? (await prisma.agency.findUnique({ where: { id: contact.agencyId }, select: { name: true } }))?.name ?? null
    : contact.wholesaleAccountId
      ? (await prisma.wholesaleAccount.findUnique({ where: { id: contact.wholesaleAccountId }, select: { name: true } }))?.name ?? null
      : null;

  return new Response(buildVCard({ accountName, contact }), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${getVCardFilename(contact.name)}"`,
      'Content-Type': 'text/vcard; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
