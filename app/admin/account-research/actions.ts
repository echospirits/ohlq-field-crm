'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requirePlatformAdmin } from '../../../lib/auth';
import { importAccountResearchCsv } from '../../../lib/accountResearch';
import {
  approveAccountResearchJob,
  createAccountResearchPilot,
  pollAccountResearchPilot,
  rejectAccountResearchJob,
  submitQueuedPilotJobs,
} from '../../../lib/accountResearchPilotService';
import { requireFeatureForUser, requireOrganizationContext } from '../../../lib/organizations';

const returnWith = (values: Record<string, string | number>): never => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) query.set(key, String(value));
  redirect(`/admin/account-research?${query.toString()}`);
};

export async function uploadAccountResearchCsv(formData: FormData) {
  const user = await requirePlatformAdmin();
  await requireOrganizationContext(user);
  await requireFeatureForUser(user, 'ADVANCED_INTELLIGENCE');
  const file = formData.get('researchFile');
  const dryRun = String(formData.get('mode') ?? 'dry-run') !== 'commit';
  if (!(file instanceof File) || file.size === 0) returnWith({ status: 'missing-file' });
  const researchFile = file as File;
  if (!researchFile.name.toLowerCase().endsWith('.csv')) returnWith({ status: 'invalid-file' });

  let redirectValues: Record<string, string | number>;
  try {
    const result = await importAccountResearchCsv({
      csv: await researchFile.text(), dryRun, importedBy: getUserDisplayName(user),
    });
    if (result.errors.length > 0) {
      redirectValues = {
        status: 'failed', rows: result.parsedRows, errors: result.errors.length,
        detail: result.errors.slice(0, 8).map((error) => `Row ${error.rowNumber}: ${error.message}`).join(' | ').slice(0, 1_500),
      };
    } else {
      revalidatePath('/admin/account-research');
      revalidatePath('/opportunities');
      revalidatePath('/alerts');
      revalidatePath('/');
      redirectValues = { status: dryRun ? 'dry-run' : 'completed', rows: result.parsedRows, imported: result.importedRows };
    }
  } catch (error) {
    redirectValues = { status: 'failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 1_500) };
  }
  returnWith(redirectValues);
}

const getPilotActor = async () => {
  const user = await requirePlatformAdmin();
  const { organizationId } = await requireOrganizationContext(user);
  await requireFeatureForUser(user, 'ADVANCED_INTELLIGENCE');
  return { user, organizationId };
};

export async function startAccountResearchPilot() {
  const { user, organizationId } = await getPilotActor();
  try {
    const pilot = await createAccountResearchPilot({ organizationId, startedByUserId: user.id });
    const submission = await submitQueuedPilotJobs({ pilotId: pilot.id, organizationId });
    revalidatePath('/admin/account-research');
    returnWith({
      status: submission.paused ? 'pilot-paused' : 'pilot-started',
      pilot: pilot.id,
      submitted: submission.submitted,
      failed: submission.failed,
      remaining: submission.remaining,
    });
  } catch (error) {
    returnWith({ status: 'pilot-failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 1_500) });
  }
}

export async function continueAccountResearchPilot(formData: FormData) {
  const { organizationId } = await getPilotActor();
  const pilotId = String(formData.get('pilotId') ?? '');
  try {
    const submission = await submitQueuedPilotJobs({ pilotId, organizationId });
    revalidatePath('/admin/account-research');
    returnWith({ status: submission.paused ? 'pilot-paused' : 'pilot-continued', submitted: submission.submitted, failed: submission.failed, remaining: submission.remaining });
  } catch (error) {
    returnWith({ status: 'pilot-failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 1_500) });
  }
}

export async function checkAccountResearchPilot(formData: FormData) {
  const { organizationId } = await getPilotActor();
  const pilotId = String(formData.get('pilotId') ?? '');
  try {
    const result = await pollAccountResearchPilot({ pilotId, organizationId });
    revalidatePath('/admin/account-research');
    returnWith({
      status: 'pilot-checked',
      checked: result.checked,
      completed: result.completed,
      pending: result.pending,
      failed: result.failedChecks + result.failed,
      applied: result.applied,
      rejected: result.rejected,
    });
  } catch (error) {
    returnWith({ status: 'pilot-failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 1_500) });
  }
}

export async function reviewAccountResearchJob(formData: FormData) {
  const { user, organizationId } = await getPilotActor();
  const jobId = String(formData.get('jobId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const reviewNote = String(formData.get('reviewNote') ?? '');
  try {
    if (decision === 'approve') {
      await approveAccountResearchJob({ jobId, organizationId, reviewedByUserId: user.id, reviewNote });
    } else if (decision === 'reject') {
      await rejectAccountResearchJob({ jobId, organizationId, reviewedByUserId: user.id, reviewNote });
    } else {
      throw new Error('Choose Approve or Reject.');
    }
    revalidatePath('/admin/account-research');
    revalidatePath('/opportunities');
    revalidatePath('/alerts');
    revalidatePath('/');
    returnWith({ status: decision === 'approve' ? 'pilot-approved' : 'pilot-rejected' });
  } catch (error) {
    returnWith({ status: 'pilot-failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 1_500) });
  }
}
