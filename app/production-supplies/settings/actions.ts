'use server';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminSession } from '../../../lib/auth';
import { requireFeatureForUser } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { readAccountConfiguration } from '../../../lib/crm/accountConfiguration';
import { saveAccountConfiguration } from '../../../lib/crm/accountMetadata';
import { requireSupplyMailboxOwner } from '../../../lib/productionSupplies/access';
import { supplySettingsInput } from '../../../lib/productionSupplies/config';
import { reconcileSupplyMailboxes } from '../../../lib/productionSupplies/mail';

export async function saveSupplySettings(form: FormData) {
  const { user } = await requireAdminSession();
  const context = await requireFeatureForUser(user, 'PRODUCTION_SUPPLIES');
  const result = supplySettingsInput.safeParse({ productionTeamId: form.get('productionTeamId') || '', viewerUserIds: form.getAll('viewerUserIds'), managerUserIds: form.getAll('managerUserIds'), historyDays: form.get('historyDays'), pollMinutes: form.get('pollMinutes'), includeSent: form.get('includeSent') === 'on' });
  if (!result.success) redirect('/production-supplies/settings?status=invalid-settings');
  const input = result.data;
  const members = [...new Set(form.getAll('memberIds').map(String))];
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-settings:${context.organizationId}`},0))`;
      const org = await tx.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { crmPreferences: true } });
      const config = readAccountConfiguration(org.crmPreferences);
      if (Number(form.get('version')) !== config.version) throw new Error('Settings changed. Reload before saving.');
      const users = [...new Set([...members, ...input.viewerUserIds, ...input.managerUserIds])];
      if (await tx.user.count({ where: { id: { in: users }, organizationId: context.organizationId, isActive: true, role: { not: 'PLATFORM_ADMIN' } } }) !== users.length) throw new Error('Choose active users from this organization.');
      const existing = config.teams.find(team => team.id === input.productionTeamId);
      if (input.productionTeamId && !existing) throw new Error('Choose an existing team.');
      const team = existing ?? config.teams.find(team => team.name.toLowerCase() === 'production') ?? { id: randomUUID(), name: 'Production', memberIds: [] };
      await saveAccountConfiguration(tx, { organizationId: context.organizationId, userId: user.id }, { ...config, teams: [...config.teams.filter(t => t.id !== team.id), { ...team, memberIds: members }] });
      const fresh = await tx.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { crmPreferences: true } });
      await tx.organization.update({ where: { id: context.organizationId }, data: { crmPreferences: { ...(fresh.crmPreferences as Prisma.JsonObject), productionSupplies: { ...input, productionTeamId: team.id } } } });
      await tx.organizationAuditEvent.create({ data: { organizationId: context.organizationId, actorUserId: user.id, action: 'ORGANIZATION_UPDATED', metadata: { kind: 'PRODUCTION_SUPPLIES_SETTINGS', before: (org.crmPreferences as Prisma.JsonObject | null)?.productionSupplies ?? null, after: { ...input, productionTeamId: team.id } } } });
    });
    // Queue initial ingestion for every existing authorized team mailbox immediately.
    await reconcileSupplyMailboxes(context.organizationId);
  } catch { redirect('/production-supplies/settings?status=save-failed'); }
  revalidatePath('/production-supplies'); revalidatePath('/production-supplies/settings'); revalidatePath('/users');
  redirect('/production-supplies/settings?status=saved');
}
export async function disconnectSupplyMailbox() {
  const { user, context } = await requireSupplyMailboxOwner();
  await prisma.mailboxConnection.updateMany({ where: { organizationId: context.organizationId, userId: user.id }, data: { enabled: false, accessTokenEncrypted: null, refreshTokenEncrypted: null, errorCode: 'OWNER_DISCONNECTED' } });
  await reconcileSupplyMailboxes(context.organizationId);
  revalidatePath('/production-supplies/settings'); redirect('/production-supplies/settings?status=disconnected');
}
export async function queueSupplyMailbox() {
  const { user, context } = await requireSupplyMailboxOwner();
  await reconcileSupplyMailboxes(context.organizationId);
  await prisma.supplyMailboxSync.updateMany({ where: { organizationId: context.organizationId, userId: user.id, connectionId: { not: null }, status: { not: 'PAUSED' }, nextSyncAt: { lt: new Date(Date.now() + 60_000) } }, data: { nextSyncAt: new Date() } });
  revalidatePath('/production-supplies/settings'); redirect('/production-supplies/settings?status=queued');
}
