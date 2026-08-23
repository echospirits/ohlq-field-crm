export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { formatEasternDateTime } from '../../../lib/dateTime';
import { prisma } from '../../../lib/prisma';
import { TagBadges } from '../TagBadges';
import { EmptyState, PageHeader, SectionHeading } from '../../components/PageChrome';

export const metadata = buildPageMetadata('Tag');

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
      <PageHeader
        actions={<Link className="btn secondary" href="/tags">Back to tags</Link>}
        description={tag.description || 'Accounts currently carrying this tag.'}
        eyebrow="Account organization"
        title={<><TagBadges tags={[tag]} /> accounts</>}
      />

      <div className="grid account-summary-grid">
        <div className="card metric-card">
          <h3>Accounts with tag</h3>
          <p className="metric-value">{tag.locationTags.length}</p>
        </div>
        <div className="card metric-card">
          <h3>Tag created</h3>
          <p className="metric-caption">
            {formatEasternDateTime(tag.createdAt)} by{' '}
            {tag.createdByUser ? getUserDisplayName(tag.createdByUser) : 'Unknown user'}
          </p>
        </div>
      </div>

      <section className="content-section">
      <SectionHeading count={tag.locationTags.length} title="Tagged accounts" />
      {tag.locationTags.length === 0 ? (
        <EmptyState description="Apply this tag from an agency or wholesale account workspace." title="No accounts have this tag" />
      ) : (
        <div className="table-scroll"><table className="responsive-table">
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
                  <td data-label="Added">{formatEasternDateTime(assignment.createdAt)}</td>
                  <td data-label="Added By">
                    {assignment.createdByUser ? getUserDisplayName(assignment.createdByUser) : 'Unknown user'}
                  </td>
                  <td data-label="Note">{assignment.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      </section>
    </>
  );
}
