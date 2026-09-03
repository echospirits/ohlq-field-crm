export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { formatEasternDate } from '../../../lib/dateTime';
import { getAgencyRecentItemSales } from '../../../lib/ohlqSalesData';
import { prisma } from '../../../lib/prisma';
import { getOrganizationFeatures, requireOrganizationContext } from '../../../lib/organizations';
import { AgencyRecentSalesCard } from '../AgencyRecentSalesCard';
import { AgencyIntelligencePanel } from '../AgencyIntelligencePanel';
import { AccountTagPanel } from '../../tags/AccountTagPanel';
import { TagBadges } from '../../tags/TagBadges';
import { VisitActivityTable } from '../../visits/VisitActivityTable';
import { AccountWorkspaceNavigation } from '../../components/AccountWorkspaceNavigation';
import { OpportunityAccountPanel } from '../../wholesale/OpportunityAccountPanel';
import { ContextualActions } from '../../components/ContextualActions';

const formatVisitDate = (date: Date | null | undefined) => formatEasternDate(date) || 'No visits yet';
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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agency = await prisma.agency.findUnique({ where: { id }, select: { name: true } });
  return buildPageMetadata(agency?.name ?? 'Agency');
}

export default async function AgencyActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string; tagStatus?: string }>;
}) {
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const enabledFeatures = await getOrganizationFeatures(organizationId);
  const hasAgencyIntelligence = enabledFeatures.has('AGENCY_INTELLIGENCE');
  const hasWholesaleOpportunities = enabledFeatures.has('WHOLESALE_OPPORTUNITIES');
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const agency = await prisma.agency.findUnique({
    where: { id },
    include: {
          tags: { where: { organizationId },
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

  const [visits, tags, salesWindows, users] = await Promise.all([
    prisma.loggedVisit.findMany({
      where: {
        agencyId: id,
        organizationId,
        locationType: 'agency',
      },
      include: {
        createdByUser: true,
        photos: {
          orderBy: { createdAt: 'asc' },
        },
        worklistItems: {
          select: { id: true, status: true, title: true },
        },
      },
      orderBy: [{ visitAt: 'desc' }],
    }),
    prisma.tag.findMany({ where: { organizationId }, orderBy: [{ name: 'asc' }] }),
    getAgencyRecentItemSales({ agencyId: agency.agencyId }),
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { not: 'TASTER' } }, orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
  ]);
  const actionUsers = users.map((user) => ({ id: user.id, name: getUserDisplayName(user) }));

  const contacts = await prisma.locationContact.findMany({
    where: { organizationId, id: { in: visits.map((visit) => visit.contactId).filter(Boolean) as string[] } },
  });
  const contactMap = Object.fromEntries(contacts.map((contact) => [contact.id, contact.name]));
  const latestVisitAt = visits[0]?.visitAt;

  return (
    <>
      <header className="page-heading page-header account-workspace-heading">
        <div>
          <span className="page-eyebrow">Agency {agency.agencyId}</span>
          <h1>{agency.name}</h1>
          <TagBadges tags={agency.tags.map((assignment) => assignment.tag)} />
        </div>
        <div className="page-heading-actions">
          <ContextualActions
            address={[agency.address, agency.city, agency.state, agency.zip].filter(Boolean).join(', ')}
            context={{ accountName: agency.name, agencyId: agency.id, returnTo: `/agencies/${agency.id}`, sourceLabel: agency.name, sourceType: 'AGENCY_DETAIL' }}
            currentUserId={currentUser.id}
            phone={agency.primaryContactPhone ?? agency.phone}
            users={actionUsers}
          />
          <Link className="btn compact-btn secondary" href={`/visits/new?type=agency&agencyId=${agency.id}&voice=1`}>Voice note</Link>
        </div>
      </header>
      {query.status ? <p className="toast-notice" role="status">{statusMessages[query.status] ?? query.status}</p> : null}
      {query.tagStatus ? <p className="pill">{tagStatusMessages[query.tagStatus] ?? query.tagStatus}</p> : null}
      <AccountWorkspaceNavigation sections={[
        { href: '#overview', label: 'Overview' },
        ...(hasAgencyIntelligence || hasWholesaleOpportunities ? [{ href: '#intelligence', label: 'Intelligence' }] : []),
        { href: '#current-inventory', label: 'Inventory' },
        { href: '#sales', label: 'Sales' },
        { href: '#wholesale-influence', label: 'Wholesale' },
        { href: '#activity', label: 'Activity' },
      ]} />

      <div className="grid account-summary-grid account-workspace-section" id="overview">
        <div className="card metric-card">
          <h3>Logged visits</h3>
          <p className="metric-value">{visits.length}</p>
        </div>
        <div className="card metric-card">
          <h3>Most recent visit</h3>
          <p className="metric-caption">{formatVisitDate(latestVisitAt)}</p>
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

      {hasAgencyIntelligence ? <div className="account-workspace-section" id="intelligence">
        <AgencyIntelligencePanel agencyId={agency.id} agencyName={agency.name} currentUserId={currentUser.id} organizationId={organizationId} users={actionUsers} />
      </div> : null}

      {hasWholesaleOpportunities ? <div className="account-workspace-section" id={hasAgencyIntelligence ? undefined : 'intelligence'}>
        <OpportunityAccountPanel agencyId={agency.agencyId} currentUserId={currentUser.id} returnTo={`/agencies/${agency.id}`} users={actionUsers} />
      </div> : null}

      <div className="account-workspace-section" id="sales">
        <AgencyRecentSalesCard salesWindows={salesWindows} />
      </div>

      <section className="dashboard-section account-workspace-section" id="activity">
        <div className="section-heading">
          <h2>Logged Visit Activity</h2>
          <span className="pill">{visits.length}</span>
        </div>
        <VisitActivityTable contactMap={contactMap} visits={visits} />
      </section>
    </>
  );
}
