'use server';
import { z } from 'zod';
import { OrganizationAuditAction } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireEchoAdmin } from '../../../lib/auth';
import { requireOrganizationContext, writeOrganizationAudit } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { discoverOrganizationProducts } from '../../../lib/organizationProductDiscovery';

export async function addEchoVendor(form: FormData) {
  const actor = await requireEchoAdmin();
  const { organizationId } = await requireOrganizationContext(actor);
  const parsed = z.object({ vendorId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/), label: z.string().trim().max(160) }).safeParse({ vendorId: form.get('vendorId'), label: form.get('label') ?? '' });
  if (!parsed.success) redirect('/admin/organization?status=invalid-vendor');
  const { vendorId, label } = parsed.data;
  await prisma.$transaction(async tx => {
    await tx.organizationVendorIdentifier.upsert({ where: { organizationId_market_vendorId: { organizationId, market: 'OH', vendorId } }, create: { organizationId, market: 'OH', vendorId, label: label || null }, update: { active: true, label: label || null } });
    await tx.organizationAuditEvent.create({ data: { actorUserId: actor.id, organizationId, action: OrganizationAuditAction.VENDOR_IDENTIFIER_ADDED, metadata: { vendorId } } });
  });
  try {
    const result = await discoverOrganizationProducts({ organizationId });
    await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.PRODUCT_CONFIGURATION_CHANGED, { discoveredProducts: result.created });
  } catch {
    revalidatePath('/admin/organization');
    redirect('/admin/organization?status=vendor-saved-discovery-pending');
  }
  revalidatePath('/admin/organization');
  redirect('/admin/organization?status=vendor-saved');
}
