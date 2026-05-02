export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { AccountTagPanel } from '../../tags/AccountTagPanel';
import { TagBadges } from '../../tags/TagBadges';
import { VisitActivityTable } from '../../visits/VisitActivityTable';

const formatDate = (date: Date | null | undefined) => (date ? new Date(date).toLocaleDateString() : 'No visits yet');
const tagStatusMessages: Record<string, string> = {
  added: 'Tag added.',
  removed: 'Tag removed.',
  invalid: 'Select a valid tag.',
};

export default async function WholesaleActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tagStatus?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const account = await prisma.wholesaleAccount.findUnique({
    where: { id },
    include: {
      tags: {
        include: {
          tag: true,
          createdByUser: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!account) {
    notFound();
  }

  const [visits, tags] = await Promise.all([
    prisma.loggedVisit.findMany({
      where: {
        wholesaleAccountId: id,
        locationType: 'wholesale',
      },
      include: {
        createdByUser: true,
        photos: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ visitAt: 'desc' }],
    }),
    prisma.tag.findMany({ orderBy: [{ name: 'asc' }] }),
  ]);

  const contacts = await prisma.locationContact.findMany({
    where: { id: { in: visits.map((visit) => visit.contactId).filter(Boolean) as string[] } },
  });
  const contactMap = Object.fromEntries(contacts.map((contact) => [contact.id, contact.name]));
  const latestVisitAt = visits[0]?.visitAt;

  return (
    <>
      <div className="page-actions">
        <Link href="/wholesale">Back to wholesale accounts</Link>
        <Link className="btn compact-btn" href={`/visits/new?type=wholesale&wholesaleAccountId=${account.id}`}>
          Log Visit
        </Link>
      </div>

      <h1>{account.name}</h1>
      <p className="muted">Licensee {account.licenseeId}</p>
      {query.tagStatus ? <p className="pill">{tagStatusMessages[query.tagStatus] ?? query.tagStatus}</p> : null}
      <TagBadges tags={account.tags.map((assignment) => assignment.tag)} />

      <div className="grid account-summary-grid">
        <div className="card metric-card">
          <h3>Logged visits</h3>
          <p className="metric-value">{visits.length}</p>
        </div>
        <div className="card metric-card">
          <h3>Most recent visit</h3>
          <p className="metric-caption">{formatDate(latestVisitAt)}</p>
        </div>
        <div className="card account-detail-list">
          <h3>Account details</h3>
          <p>
            <strong>Address</strong>
            <span>{[account.address, account.city, account.state, account.zip].filter(Boolean).join(', ')}</span>
          </p>
          <p>
            <strong>Agency ID</strong>
            <span>{account.agencyId}</span>
          </p>
          <p>
            <strong>County</strong>
            <span>{account.county}</span>
          </p>
          <p>
            <strong>Phone</strong>
            <span>{account.phone}</span>
          </p>
          <p>
            <strong>Delivery day</strong>
            <span>{account.deliveryDay}</span>
          </p>
        </div>
        <AccountTagPanel
          assignments={account.tags}
          locationId={account.id}
          locationType="wholesale"
          returnTo={`/wholesale/${account.id}`}
          tags={tags}
        />
      </div>

      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Logged Visit Activity</h2>
          <span className="pill">{visits.length}</span>
        </div>
        <VisitActivityTable contactMap={contactMap} visits={visits} />
      </section>
    </>
  );
}
