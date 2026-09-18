export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { SubmitButton } from '../../components/SubmitButton';
import { WeeklyDigestStatus } from '@prisma/client';
import { APP_NAME, buildPageMetadata } from '../../../lib/appBrand';
import { getUserDisplayName, requireAdminSession } from '../../../lib/auth';
import { requireOrganizationContext } from '../../../lib/organizations';
import { formatEasternDateTime } from '../../../lib/dateTime';
import { prisma } from '../../../lib/prisma';
import { getTenantWeeklyDigest, getWeeklyDigestWindow, renderTenantWeeklyDigestEmail } from '../../../lib/weeklyDigest';
import { sendWeeklyDigestManualAction, sendWeeklyDigestTestAction } from './actions';
import { PageHeader, SectionHeading } from '../../components/PageChrome';

export const metadata = buildPageMetadata('Weekly Digest');

const statusMessages: Record<string, string> = {
  'test-sent': 'Test digest sent to your email.',
  'test-suppressed': 'Test digest was safely suppressed because email delivery is disabled in this environment.',
  'test-failed': 'Test digest failed.',
  'manual-sent': 'Manual weekly digest run finished.',
  'manual-failed': 'Manual weekly digest run failed.',
  'missing-admin-email': 'Your admin account needs an email address before test sends can run.',
};

export default async function WeeklyDigestAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{
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
  const window = getWeeklyDigestWindow();
  const [digest, recentLogs, recipientCount] = await Promise.all([
    getTenantWeeklyDigest(organizationId, window),
    prisma.weeklyDigestLog.findMany({ where: { organizationId }, orderBy: [{ createdAt: 'desc' }], take: 20, include: { recipientUser: true } }),
    prisma.user.count({ where: { organizationId, isActive: true, email: { not: '' } } }),
  ]);
  const rendered = renderTenantWeeklyDigestEmail(digest);

  return (
    <>
      <PageHeader
        description={<>Preview and send controls for the Friday morning {APP_NAME} weekly email.</>}
        eyebrow="Administration"
        title="Weekly Digest"
      />

      {params.status ? (
        <p role="status" className="toast-notice page-status">
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
        <SectionHeading actions={<span className="pill">Tenant brief</span>} description="The same tenant-wide brief goes to every active user with an email address, including Tasters." title="Preview" />

        <div className="card admin-panel digest-admin-panel">
          <p>{digest.organization.displayName} &middot; {recipientCount} active users with email</p>
          <p className="muted">Test sends go only to you. Sending to the tenant skips recipients who already received this week's digest.</p>
          {!session.user.email ? <p>Your account needs an email address before you can send a test.</p> : null}
          <div className="digest-action-row">
            <form action={sendWeeklyDigestTestAction}>
              <SubmitButton type="submit" disabled={!session.user.email}>Send test to me</SubmitButton>
            </form>
            <form action={sendWeeklyDigestManualAction}>
              <SubmitButton className="secondary" type="submit">
                Send this brief to tenant
              </SubmitButton>
            </form>
          </div>
        </div>

        <div className="digest-preview-shell">
          <div className="digest-preview-meta">
            <strong>{rendered.subject}</strong>
            <span className="muted">Rendered with current Neat data. Test sends use your admin email.</span>
          </div>
          <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" className="digest-preview-frame" srcDoc={rendered.html} title="Weekly digest email preview" />
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
            {recentLogs.length === 0 ? <tr><td colSpan={6}>No digest deliveries recorded for this tenant yet.</td></tr> : null}
            {recentLogs.map((log) => (
              <tr key={log.id}>
                <td data-label="Recipient">
                  {log.recipientUser ? getUserDisplayName(log.recipientUser) : 'Unknown user'}
                  <div className="muted">{log.recipientEmail}</div>
                </td>
                <td data-label="Type">{log.digestType === 'ADMIN_WEEKLY' ? 'Tenant brief' : 'Legacy user digest'}</td>
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
