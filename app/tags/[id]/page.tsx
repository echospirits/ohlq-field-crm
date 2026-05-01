export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { TagBadges } from '../TagBadges';

const formatDateTime = (date: Date) => new Date(date).toLocaleString();

export default async function TagDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const tag = await prisma.tag.findUnique({
    where: { id },
    include: {
      createdByUser: true,
      locationTags: {
        include: {
          agency: true,
          wholesaleAccount: true,
          createdByUser: true,
        },
        orderBy: [{ createdAt: 'desc' }],
      },
    },
  });

  if (!tag) {
    notFound();
  }

  return (
    <>
      <div className="page-actions">
        <Link href="/tags">Back to tags</Link>
      </div>

      <h1>Tagged Accounts</h1>
      <TagBadges tags={[tag]} />
      {tag.description ? <p className="muted">{tag.description}</p> : null}

      <div className="grid account-summary-grid">
        <div className="card metric-card">
          <h3>Accounts with tag</h3>
          <p className="metric-value">{tag.locationTags.length}</p>
        </div>
        <div className="card metric-card">
          <h3>Tag created</h3>
          <p className="metric-caption">
            {formatDateTime(tag.createdAt)} by{' '}
            {tag.createdByUser ? getUserDisplayName(tag.createdByUser) : 'Unknown user'}
          </p>
        </div>
      </div>

      {tag.locationTags.length === 0 ? (
        <p className="muted activity-empty">No accounts have this tag yet.</p>
      ) : (
        <table className="responsive-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th>Added</th>
              <th>Added By</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {tag.locationTags.map((assignment) => {
              const account = assignment.agency ?? assignment.wholesaleAccount;
              const accountType = assignment.agency ? 'Agency' : 'Wholesale';
              const href = assignment.agency
                ? `/agencies/${assignment.agency.id}`
                : assignment.wholesaleAccount
                  ? `/wholesale/${assignment.wholesaleAccount.id}`
                  : '#';

              return (
                <tr key={assignment.id}>
                  <td data-label="Account">
                    {account ? (
                      <Link className="table-link" href={href}>
                        {account.name}
                      </Link>
                    ) : (
                      'Unknown account'
                    )}
                  </td>
                  <td data-label="Type">{accountType}</td>
                  <td data-label="Added">{formatDateTime(assignment.createdAt)}</td>
                  <td data-label="Added By">
                    {assignment.createdByUser ? getUserDisplayName(assignment.createdByUser) : 'Unknown user'}
                  </td>
                  <td data-label="Note">{assignment.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
