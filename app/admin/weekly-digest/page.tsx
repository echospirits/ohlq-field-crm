export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { WeeklyDigestStatus } from '@prisma/client';
import { getUserDisplayName, requireAdminSession } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import {
  getAdminWeeklyDigest,
  getUserWeeklyDigest,
  getWeeklyDigestWindow,
  renderAdminWeeklyDigestEmail,
  renderUserWeeklyDigestEmail,
} from '../../../lib/weeklyDigest';
import { sendWeeklyDigestManualAction, sendWeeklyDigestTestAction } from './actions';

const statusMessages: Record<string, string> = {
  'test-sent': 'Test digest sent to your email.',
  'test-failed': 'Test digest failed.',
  'manual-sent': 'Manual weekly digest run finished.',
  'manual-failed': 'Manual weekly digest run failed.',
  'missing-admin-email': 'Your admin account needs an email address before test sends can run.',
};

const formatDateTime = (date: Date | null | undefined) =>
  date
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date)
    : '';

const getPreviewMode = (value: string | undefined) => (value === 'admin' ? 'admin' : 'user');

export default async function WeeklyDigestAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{
    digestType?: string;
    userId?: string;
    status?: string;
    message?: string;
    attempted?: string;
    sent?: string;
    skipped?: string;
    failed?: string;
  }>;
}) {
  const session = await requireAdminSession();
  const params = (await searchParams) ?? {};
  const previewMode = getPreviewMode(params.digestType);
  const window = getWeeklyDigestWindow();
  const [activeUsers, recentLogs] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        name: true,
        role: true,
      },
    }),
    prisma.weeklyDigestLog.findMany({
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
      include: { recipientUser: true },
    }),
  ]);
  const selectedUserId =
    activeUsers.some((user) => user.id === params.userId) && params.userId ? params.userId : session.user.id;
  const rendered =
    previewMode === 'admin'
      ? renderAdminWeeklyDigestEmail(await getAdminWeeklyDigest(window))
      : renderUserWeeklyDigestEmail(await getUserWeeklyDigest(selectedUserId, window));

  return (
    <>
      <h1>Weekly Digest</h1>
      <p className="muted">
        Admin-only preview and send controls for the Friday 8:00 AM Eastern Echo CRM weekly email.
      </p>

      {params.status ? (
        <p className="pill">
          {statusMessages[params.status] ?? params.status}
          {params.attempted
            ? ` Attempted ${params.attempted}, sent ${params.sent ?? 0}, skipped ${params.skipped ?? 0}, failed ${
                params.failed ?? 0
              }.`
            : ''}
          {params.message ? ` ${params.message}` : ''}
        </p>
      ) : null}

      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Preview</h2>
          <span className="pill">{previewMode === 'admin' ? 'Team digest' : 'User digest'}</span>
        </div>

        <div className="card admin-panel digest-admin-panel">
          <form className="digest-control-form">
            <label>
              Digest
              <select name="digestType" defaultValue={previewMode}>
                <option value="user">User digest</option>
                <option value="admin">Admin team digest</option>
              </select>
            </label>
            <label>
              User preview
              <select name="userId" defaultValue={selectedUserId} disabled={previewMode === 'admin'}>
                {activeUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {getUserDisplayName(user)} ({user.email ?? 'no email'})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Preview digest</button>
          </form>

          <div className="digest-action-row">
            <form action={sendWeeklyDigestTestAction}>
              <input name="digestType" type="hidden" value={previewMode} />
              <input name="userId" type="hidden" value={selectedUserId} />
              <button type="submit">Send test to me</button>
            </form>
            <form action={sendWeeklyDigestManualAction}>
              <button className="secondary" type="submit">
                Send current digest to all recipients
              </button>
            </form>
          </div>
        </div>

        <div className="digest-preview-shell">
          <div className="digest-preview-meta">
            <strong>{rendered.subject}</strong>
            <span className="muted">Rendered with current CRM data. Test sends use your admin email.</span>
          </div>
          <iframe className="digest-preview-frame" srcDoc={rendered.html} title="Weekly digest email preview" />
          <details className="compact-details cardless-details">
            <summary>Plain text version</summary>
            <pre className="digest-text-preview">{rendered.text}</pre>
          </details>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Recent digest logs</h2>
          <span className="pill">{recentLogs.length}</span>
        </div>
        <table className="responsive-table">
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Type</th>
              <th>Period</th>
              <th>Status</th>
              <th>Run</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {recentLogs.map((log) => (
              <tr key={log.id}>
                <td data-label="Recipient">
                  {log.recipientUser ? getUserDisplayName(log.recipientUser) : 'Unknown user'}
                  <div className="muted">{log.recipientEmail}</div>
                </td>
                <td data-label="Type">{log.digestType === 'ADMIN_WEEKLY' ? 'Admin team' : 'User'}</td>
                <td data-label="Period">
                  {formatDateTime(log.periodStart)} - {formatDateTime(log.periodEnd)}
                </td>
                <td data-label="Status">
                  <span className={log.status === WeeklyDigestStatus.FAILED ? 'pill danger-pill' : 'pill'}>
                    {log.status.toLowerCase()}
                  </span>
                </td>
                <td data-label="Run">{formatDateTime(log.runAt ?? log.scheduledFor)}</td>
                <td data-label="Message">{log.errorMessage ?? log.lastSkipReason ?? log.providerMessageId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
