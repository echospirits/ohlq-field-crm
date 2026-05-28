export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../lib/auth';
import { getAgencyRecentItemSales } from '../../../lib/ohlqSalesData';
import { prisma } from '../../../lib/prisma';
import { AgencyRecentSalesCard } from '../AgencyRecentSalesCard';
import { AccountTagPanel } from '../../tags/AccountTagPanel';
import { TagBadges } from '../../tags/TagBadges';
import { VisitActivityTable } from '../../visits/VisitActivityTable';

const formatDate = (date: Date | null | undefined) => (date ? new Date(date).toLocaleDateString() : 'No visits yet');
const tagStatusMessages: Record<string, string> = {
  added: 'Tag added.',
  removed: 'Tag removed.',
  invalid: 'Select a valid tag.',
};
const statusMessages: Record<string, string> = {
  'visit-logged': 'Visit logged.',
  'visit-logged-photo-upload-failed': 'Visit logged, but one or more photos could not be uploaded.',
  'visit-logged-worklist-completed': 'Visit logged and worklist item completed.',
};

export default async function AgencyActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string; tagStatus?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const agency = await prisma.agency.findUnique({
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

  if (!agency) {
    notFound();
  }

  const [visits, tags, salesWindows] = await Promise.all([
    prisma.loggedVisit.findMany({
      where: {
        agencyId: id,
        locationType: 'agency',
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
    getAgencyRecentItemSales({ agencyId: agency.agencyId }),
  ]);

  const contacts = await prisma.locationContact.findMany({
    where: { id: { in: visits.map((visit) => visit.contactId).filter(Boolean) as string[] } },
  });
  const contactMap = Object.fromEntries(contacts.map((contact) => [contact.id, contact.name]));
  const latestVisitAt = visits[0]?.visitAt;

  return (
    <>
      <div className="page-actions">
        <Link href="/agencies">Back to agencies</Link>
        <Link className="btn compact-btn" href={`/visits/new?type=agency&agencyId=${agency.id}`}>
          Log visit
        </Link>
        <Link className="btn compact-btn secondary" href={`/visits/new?type=agency&agencyId=${agency.id}&voice=1`}>
          Voice note
        </Link>
      </div>

      <h1>{agency.name}</h1>
      <p className="muted">Agency {agency.agencyId}</p>
      {query.status ? <p className="toast-notice" role="status">{statusMessages[query.status] ?? query.status}</p> : null}
      {query.tagStatus ? <p className="pill">{tagStatusMessages[query.tagStatus] ?? query.tagStatus}</p> : null}
      <TagBadges tags={agency.tags.map((assignment) => assignment.tag)} />

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
            <span>{[agency.address, agency.city, agency.state, agency.zip].filter(Boolean).join(', ')}</span>
          </p>
          <p>
            <strong>Primary contact</strong>
            <span>{agency.primaryContact}</span>
          </p>
          <p>
            <strong>Contact phone</strong>
            <span>{agency.primaryContactPhone}</span>
          </p>
          <p>
            <strong>Agency phone</strong>
            <span>{agency.phone}</span>
          </p>
        </div>
        <AccountTagPanel
          assignments={agency.tags}
          locationId={agency.id}
          locationType="agency"
          returnTo={`/agencies/${agency.id}`}
          tags={tags}
        />
      </div>

      <AgencyRecentSalesCard salesWindows={salesWindows} />

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
