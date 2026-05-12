'use server';

import { redirect } from 'next/navigation';
import { requireAdminSession } from '../../../lib/auth';
import {
  getAdminWeeklyDigest,
  getUserWeeklyDigest,
  getWeeklyDigestWindow,
  renderAdminWeeklyDigestEmail,
  renderUserWeeklyDigestEmail,
  sendTestWeeklyDigestEmail,
  sendWeeklyDigestForAllUsers,
} from '../../../lib/weeklyDigest';

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const redirectWithStatus = (status: string, params?: Record<string, string | number>): never => {
  const query = new URLSearchParams({ status });

  for (const [key, value] of Object.entries(params ?? {})) {
    query.set(key, String(value));
  }

  redirect(`/admin/weekly-digest?${query.toString()}`);
};

export async function sendWeeklyDigestTestAction(formData: FormData) {
  const session = await requireAdminSession();
  const digestType = String(formData.get('digestType') ?? 'user') === 'admin' ? 'admin' : 'user';
  const selectedUserId = toOptional(formData.get('userId')) ?? session.user.id;
  const recipientEmail = session.user.email;

  if (!recipientEmail) {
    redirectWithStatus('missing-admin-email');
  }

  try {
    const window = getWeeklyDigestWindow();
    const rendered =
      digestType === 'admin'
        ? renderAdminWeeklyDigestEmail(await getAdminWeeklyDigest(window))
        : renderUserWeeklyDigestEmail(await getUserWeeklyDigest(selectedUserId, window));

    await sendTestWeeklyDigestEmail({
      recipientEmail,
      rendered,
    });
  } catch (error) {
    redirectWithStatus('test-failed', {
      message: error instanceof Error ? error.message.slice(0, 120) : 'Unknown failure',
    });
  }

  redirectWithStatus('test-sent', {
    digestType,
    userId: selectedUserId,
  });
}

export async function sendWeeklyDigestManualAction() {
  await requireAdminSession();
  let result: Awaited<ReturnType<typeof sendWeeklyDigestForAllUsers>> | null = null;

  try {
    result = await sendWeeklyDigestForAllUsers({
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
