'use server';

import { redirect } from 'next/navigation';
import { requireAdminSession } from '../../../lib/auth';
import { requireOrganizationContext } from '../../../lib/organizations';
import {
  getTenantWeeklyDigest,
  getWeeklyDigestWindow,
  renderTenantWeeklyDigestEmail,
  sendTestWeeklyDigestEmail,
  sendWeeklyDigestForAllUsers,
} from '../../../lib/weeklyDigest';

const redirectWithStatus = (status: string, params?: Record<string, string | number>): never => {
  const query = new URLSearchParams({ status });

  for (const [key, value] of Object.entries(params ?? {})) {
    query.set(key, String(value));
  }

  redirect(`/admin/weekly-digest?${query.toString()}`);
};

export async function sendWeeklyDigestTestAction() {
  const session = await requireAdminSession();
  const { organizationId } = await requireOrganizationContext(session.user);
  const recipientEmail = session.user.email;

  if (!recipientEmail) {
    redirectWithStatus('missing-admin-email');
  }

  let suppressed = false;
  try {
    const window = getWeeklyDigestWindow();
    const rendered = renderTenantWeeklyDigestEmail(await getTenantWeeklyDigest(organizationId, window));

    const delivery = await sendTestWeeklyDigestEmail({
      recipientEmail,
      rendered,
    });
    suppressed = Boolean(delivery.suppressed);
  } catch (error) {
    redirectWithStatus('test-failed', {
      message: error instanceof Error ? error.message.slice(0, 120) : 'Unknown failure',
    });
  }

  redirectWithStatus(suppressed ? 'test-suppressed' : 'test-sent');
}

export async function sendWeeklyDigestManualAction() {
  const session = await requireAdminSession();
  const { organizationId } = await requireOrganizationContext(session.user);
  let result: Awaited<ReturnType<typeof sendWeeklyDigestForAllUsers>> | null = null;

  try {
    result = await sendWeeklyDigestForAllUsers({
      organizationId,
      window: getWeeklyDigestWindow(),
    });
  } catch (error) {
    redirectWithStatus('manual-failed', {
      message: error instanceof Error ? error.message.slice(0, 120) : 'Unknown failure',
    });
  }

  if (!result) {
    redirectWithStatus('manual-failed');
  }

  const finalResult = result!;

  redirectWithStatus('manual-sent', {
    attempted: finalResult.attempted,
    sent: finalResult.sent,
    skipped: finalResult.skipped + finalResult.missingEmailSkipped,
    failed: finalResult.failed,
  });
}
