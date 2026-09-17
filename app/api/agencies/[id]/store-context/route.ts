import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getCurrentUser } from '../../../../../lib/auth';
import { getOrganizationFeatures, requireOrganizationContext } from '../../../../../lib/organizations';
import { prisma } from '../../../../../lib/prisma';
import { readStoreContext, storeContextSchema } from '../../../../../lib/agencyStoreContext';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Please save from this account page.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in again before saving.' }, { status: 401 });
  if (user.role === 'TASTER') return NextResponse.json({ error: 'Your role cannot edit store context.' }, { status: 403 });
  const { organizationId } = await requireOrganizationContext(user);
  if (!(await getOrganizationFeatures(organizationId)).has('AGENCY_INTELLIGENCE')) return NextResponse.json({ error: 'Agency intelligence is not enabled for your organization.' }, { status: 403 });
  const { id } = await params;
  if (!(await prisma.agency.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: 'Agency no longer exists.' }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = storeContextSchema.safeParse(body?.context);
  if (!parsed.success) return NextResponse.json({ error: 'Check the highlighted store context fields.', fields: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message])) }, { status: 400 });
  const key = { organizationId, accountType: 'AGENCY', externalAccountId: id };
  try {
    const existing = await prisma.organizationAccountOverlay.findUnique({ where: { organizationId_accountType_externalAccountId: key }, select: { id: true, updatedAt: true, storeContext: true } });
    const previous = readStoreContext(existing?.storeContext);
    if ((body.expectedVersion ?? null) !== (previous?.savedAt ?? null)) return NextResponse.json({ error: 'Someone updated this profile. Reload the page to review their changes before saving.' }, { status: 409 });
    const context = { ...parsed.data, version: 1, savedAt: new Date().toISOString(), savedBy: user.id };
    if (existing) {
      const result = await prisma.organizationAccountOverlay.updateMany({ where: { id: existing.id, organizationId, updatedAt: existing.updatedAt }, data: { storeContext: context } });
      if (result.count !== 1) return NextResponse.json({ error: 'The account changed while saving. Reload to review the latest information.' }, { status: 409 });
    } else {
      await prisma.organizationAccountOverlay.create({ data: { ...key, storeContext: context } });
    }
    return NextResponse.json({ context });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'The account changed while saving. Reload and try again.' }, { status: 409 });
    console.error('agency-store-context-save-failed', { agencyId: id, organizationId, error: error instanceof Error ? error.name : 'Unknown' });
    return NextResponse.json({ error: 'Store context could not be saved. Your entries are still here; try again.' }, { status: 500 });
  }
}
