'use server';
import { OrganizationAuditAction } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '../../../../lib/auth';
import { requireOrganizationContext } from '../../../../lib/organizations';
import { prisma } from '../../../../lib/prisma';
import { getOrganizationOperationalCredentials, operationalCredentialKeyStatus, requireOperationalSignalOrganization, saveOrganizationOperationalCredentials } from '../../../../lib/productionForecasting/operationalSignals/credentials';
import { OpenDockReadClient } from '../../../../lib/productionForecasting/operationalSignals/opendock';
import { checkManualDeliveryAvailability } from '../../../../lib/productionForecasting/operationalSignals/manualDelivery';
import { ohioOpenDockWarehouses } from '../../../../lib/productionForecasting/operationalSignals/ohioLocations';

const fields = z.object({ GPT: z.literal(ohioOpenDockWarehouses.GPT.warehouseId), GRN: z.literal(ohioOpenDockWarehouses.GRN.warehouseId) });
export async function configureOpenDock(formData: FormData) {
  const actor = await requireAdmin();
  const { organizationId } = await requireOrganizationContext(actor);
  await requireOperationalSignalOrganization(organizationId, prisma);
  if (!operationalCredentialKeyStatus().configured) redirect('/analytics/production/settings?status=encryption-key-required');
  let status = 'verification-failed';
  try {
    const warehouses = fields.parse({ GPT: formData.get('GPT'), GRN: formData.get('GRN') });
    const username = String(formData.get('username') ?? '').trim(), password = String(formData.get('password') ?? '');
    const credentials = username || password
      ? z.object({ email: z.string().email().max(320), password: z.string().min(1).max(2048) }).parse({ email: username, password })
      : await getOrganizationOperationalCredentials(organizationId, 'OPENDOCK');
    if (!credentials) throw new Error('Credentials required.');
    const discovery = await new OpenDockReadClient(credentials).discoverLoadTypes([warehouses.GPT, warehouses.GRN]);
    if (discovery.status !== 'SUCCESS') throw new Error('Source verification unavailable.');
    const locations = (['GPT', 'GRN'] as const).map(locationCode => {
      const matches = discovery.loadTypes.filter(load => load.warehouseId === warehouses[locationCode] && load.name === 'LTL - Pallet Load');
      if (matches.length !== 1) throw new Error('A unique authorized LTL load type is required.');
      return { market: 'OH', locationCode, locationName: locationCode === 'GPT' ? 'Groveport' : 'Green', timezone: 'America/New_York', warehouseId: warehouses[locationCode], loadTypeId: matches[0].id };
    });
    await prisma.$transaction(async tx => {
      await requireOperationalSignalOrganization(organizationId, tx);
      // Credentials and the mappings verified with them commit as one pair.
      await saveOrganizationOperationalCredentials({ organizationId, provider: 'OPENDOCK', username: credentials.email, password: credentials.password, updatedByUserId: actor.id, db: tx });
      const config = JSON.stringify({ verifiedAt: new Date().toISOString(), locations });
      // Merge against the current JSON value rather than replacing unrelated settings.
      await tx.$executeRaw`UPDATE "Organization" SET "settings" =
        COALESCE("settings", '{}'::jsonb) || jsonb_build_object('productionForecasting',
          COALESCE("settings"->'productionForecasting', '{}'::jsonb) || jsonb_build_object('operationalSignals',
            COALESCE("settings"->'productionForecasting'->'operationalSignals', '{}'::jsonb) || jsonb_build_object('opendock', ${config}::jsonb)))
        WHERE "id" = ${organizationId}`;
      await tx.organizationAuditEvent.create({ data: { actorUserId: actor.id, organizationId, action: OrganizationAuditAction.ORGANIZATION_UPDATED, metadata: { provider: 'OPENDOCK', configured: true, warehouseCodes: ['GPT', 'GRN'], loadType: 'LTL - Pallet Load' } } });
    });
    status = 'configured';
  } catch {
    // No provider response, username, password, token or raw exception in URLs/logs.
  }
  revalidatePath('/analytics/production');
  revalidatePath('/analytics/production/settings');
  redirect(`/analytics/production/settings?status=${status}`);
}

export async function checkOpenDockAvailability() {
  const result = await checkManualDeliveryAvailability();
  revalidatePath('/analytics/production');
  revalidatePath('/analytics/production/settings');
  redirect(`/analytics/production/settings?status=availability-${result.status}`);
}
