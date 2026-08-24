export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { WeeklyDigestStatus } from '@prisma/client';
import { APP_NAME, buildPageMetadata } from '../../../lib/appBrand';
import { getUserDisplayName, requireAdminSession } from '../../../lib/auth';
import { requireOrganizationContext } from '../../../lib/organizations';
import { formatEasternDateTime } from '../../../lib/dateTime';
import { prisma } from '../../../lib/prisma';
import {
  getAdminWeeklyDigest,
  getUserWeeklyDigest,
  getWeeklyDigestWindow,
  renderAdminWeeklyDigestEmail,
  renderUserWeeklyDigestEmail,
} from '../../../lib/weeklyDigest';
import { sendWeeklyDigestManualAction, sendWeeklyDigestTestAction } from './actions';
import { PageHeader, SectionHeading } from '../../components/PageChrome';

export const metadata = buildPageMetadata('Weekly Digest');

const statusMessages: Record<string, string> = {
  'test-sent': 'Test digest sent to your email.',
  'test-failed': 'Test digest failed.',
  'manual-sent': 'Manual weekly digest run finished.',
  'manual-failed': 'Manual weekly digest run failed.',
  'missing-admin-email': 'Your admin account needs an email address before test sends can run.',
};

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
  const { organizationId } = await requireOrganizationContext(session.user);
  const params = (await searchParams) ?? {};
  const previewMode = getPreviewMode(params.digestType);
  const window = getWeeklyDigestWindow();
  const [activeUsers, recentLogs] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, isActive: true, role: { not: 'PLATFORM_ADMIN' } },
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
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
      include: { recipientUser: true },
    }),
  ]);
  const selectedUserId =
    activeUsers.some((user) => user.id === params.userId) && params.userId ? params.userId : session.user.id;
  const rendered =
    previewMode === 'admin'
      ? renderAdminWeeklyDigestEmail(await getAdminWeeklyDigest(window, organizationId))
      : renderUserWeeklyDigestEmail(await getUserWeeklyDigest(selectedUserId, window));

  return (
    <>
      <PageHeader
        description={<>Preview and send controls for the Friday 8:00 AM Eastern {APP_NAME} weekly email.</>}
        eyebrow="Administration"
        title="Weekly Digest"
      />

      {params.status ? (
        <p className="toast-notice page-status">
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
        <SectionHeading actions={<span className="pill">{previewMode === 'admin' ? 'Team digest' : 'User digest'}</span>} description="Validate content with live Neat data before sending." title="Preview" />

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
            <span className="muted">Rendered with current Neat data. Test sends use your admin email.</span>
          </div>
          <iframe className="digest-preview-frame" srcDoc={rendered.html} title="Weekly digest email preview" />
          <details className="compact-details cardless-details">
            <summary>Plain text version</summary>
            <pre className="digest-text-preview">{rendered.text}</pre>
          </details>
        </div>
      </section>

      <section className="dashboard-section">
        <SectionHeading count={recentLogs.length} description="Recipient-level outcomes from recent digest runs." title="Recent digest logs" />
        <div className="table-scroll"><table className="responsive-table">
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
                  {formatEasternDateTime(log.periodStart)} - {formatEasternDateTime(log.periodEnd)}
                </td>
                <td data-label="Status">
                  <span className={log.status === WeeklyDigestStatus.FAILED ? 'pill danger-pill' : 'pill'}>
                    {log.status.toLowerCase()}
                  </span>
                </td>
                <td data-label="Run">{formatEasternDateTime(log.runAt ?? log.scheduledFor)}</td>
                <td data-label="Message">{log.errorMessage ?? log.lastSkipReason ?? log.providerMessageId}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
