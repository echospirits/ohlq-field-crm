'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '../../../../lib/auth';
import { createProvisioningRun, issueInitialAdminInvitation, runProvisioning } from '../../../../lib/tenantProvisioning';
import { prisma } from '../../../../lib/prisma';

export type InvitationActionState = { error?: string; manualUrl?: string; message?: string };

export async function issueInitialAdminInvitationAction(
  _previousState: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const actor = await requirePlatformAdmin();
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  if (!organizationId || !await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } })) return { error: 'Organization was not found.' };
  try {
    const result = await issueInitialAdminInvitation({ actorUserId: actor.id, organizationId });
    const run = await prisma.organizationProvisioningRun.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (run) await runProvisioning(run.id);
    revalidatePath(`/platform/organizations/${organizationId}`);
    return result.manualUrl
      ? { manualUrl: result.manualUrl, message: 'Email is suppressed in this environment. Copy this one-time activation link now.' }
      : { message: 'Invitation sent.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function startProvisioningAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  if (!organizationId || !await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } })) return;
  const run = await createProvisioningRun({ actorUserId: actor.id, organizationId });
  await runProvisioning(run.id);
  revalidatePath(`/platform/organizations/${organizationId}`);
}

export async function runProvisioningAction(formData: FormData) {
  await requirePlatformAdmin();
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const runId = String(formData.get('runId') ?? '').trim();
  const run = await prisma.organizationProvisioningRun.findFirst({ where: { id: runId, organizationId }, select: { id: true } });
  if (!run) return;
  await runProvisioning(run.id);
  revalidatePath(`/platform/organizations/${organizationId}`);
}
