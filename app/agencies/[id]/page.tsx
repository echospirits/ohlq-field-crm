import { accountWorkAndEvents } from '../../../lib/crm/accountTimeline';
import { AccountProfile } from '../../components/AccountProfile';
import { AccountBriefing } from '../../components/AccountBriefing';
import { activityLabels } from '../../../lib/crm/activity';
import { Suspense } from 'react';
import { AccountWorklist } from '../../components/AccountWorklist';
import { AddressLink, PhoneLink } from '../../components/AccountContactLinks';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { isAdminRole } from '../../../lib/userAccess';
import { notFound } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { formatEasternDate } from '../../../lib/dateTime';
import { getAgencyRecentItemSales } from '../../../lib/ohlqSalesData';
import { prisma } from '../../../lib/prisma';
import { getOrganizationFeatures, requireOrganizationContext } from '../../../lib/organizations';
import { getOrganizationTenantConfig } from '../../../lib/tenantConfig';
import { AgencyRecentSalesCard } from '../AgencyRecentSalesCard';
import { AgencyIntelligencePanel } from '../AgencyIntelligencePanel';
import { AccountTagPanel } from '../../tags/AccountTagPanel';
import { TagBadges } from '../../tags/TagBadges';
import { VisitActivityTable, type SupplementalActivity } from '../../visits/VisitActivityTable';
import { AccountWorkspace } from '../../components/AccountWorkspace';
import { OpportunityAccountPanel } from '../../wholesale/OpportunityAccountPanel';
import { ContextualActions } from '../../components/ContextualActions';
import { AccountMemoryPanel } from '../../account-memory/AccountMemoryPanel';
import { getCommunicationTitle } from '../../../lib/accountMemory';
import { readStoreContext } from '../../../lib/agencyStoreContext';
import { getAgencyMarketFitsForDisplay } from '../../../lib/agencyMarketIntelligenceService';
import { AgencyRetailMarketIntelligence, AgencyStoreIntelligence, AgencyStoreSummary } from '../AgencyStoreIntelligence';
import { SalesAccountType, UserRole } from '@prisma/client';
import { getAccountSalesStatusSummary, SALES_STATUS_LABELS } from '../../../lib/accountSalesStatus';
import { AccountSalesStatusPanel } from '../../components/AccountSalesStatusPanel';
import { TargetAccountControl } from '../../components/TargetAccountControl';
import { AgencyOperatingHoursEditor } from './AgencyOperatingHoursEditor';
import { readOperatingHoursDetails } from '../../../lib/operatingHours';
import { getAccountResearchPilotAvailability } from '../../../lib/accountResearchOpenAI';

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
  return buildPageMetadata(agency?.name ?? 'Retail');
}

export default async function AgencyActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string; tagStatus?: string; memoryStatus?: string; targetStatus?: string }>;
}) {
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const [tenantConfig, enabledFeatures] = await Promise.all([
    getOrganizationTenantConfig(organizationId),
    getOrganizationFeatures(organizationId),
  ]);
  const hasAgencyIntelligence = enabledFeatures.has('AGENCY_INTELLIGENCE');
  const hasWholesaleOpportunities = enabledFeatures.has('WHOLESALE_OPPORTUNITIES');
  const hasAccountSalesStatus = enabledFeatures.has('ACCOUNT_SALES_STATUS');
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

  const [visits, tags, salesWindows, users, overlay, accountContacts, communicationActivities, marketProfile, marketFits, salesStatusSummary, salesStatusHistory, targetingHistory, workAndEvents] = await Promise.all([
    prisma.loggedVisit.findMany({
      where: {
        agencyId: id,
        organizationId,
        locationType: 'agency',
      },
      include: {
        createdByUser: true,
        contacts: { include: { contact: { select: { id: true, name: true } } } },
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
    getAgencyRecentItemSales({ agencyId: agency.agencyId, config: tenantConfig }),
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { not: 'TASTER' } }, orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
    prisma.organizationAccountOverlay.findUnique({
      where: { organizationId_accountType_externalAccountId: { organizationId, accountType: 'AGENCY', externalAccountId: id } },
      select: { notes: true, storeContext: true, isTargeting: true },
    }),
    prisma.locationContact.findMany({
      where: { organizationId, agencyId: id },
      orderBy: [{ active: 'desc' }, { isPrimary: 'desc' }, { name: 'asc' }],
    }),
    prisma.accountActivity.findMany({
      where: { organizationId, agencyId: id, OR: [{ visibility: 'TEAM' }, { createdByUserId: currentUser.id }] },
      include: { contact: { select: { name: true } }, createdByUser: { select: { email: true, name: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    }),
    hasAgencyIntelligence ? prisma.agencyMarketProfile.findUnique({ where: { organizationId_agencyId: { organizationId, agencyId: id } } }) : null,
    hasAgencyIntelligence ? getAgencyMarketFitsForDisplay({ organizationId, agencyId: id }) : [],
    hasAccountSalesStatus ? getAccountSalesStatusSummary({ accountType: SalesAccountType.AGENCY, externalAccountId: id, organizationId }) : null,
    hasAccountSalesStatus ? prisma.accountSalesStatusHistory.findMany({ where: { organizationId, accountType: SalesAccountType.AGENCY, externalAccountId: id }, orderBy: { changedAt: 'desc' }, take: 50 }) : [],
    prisma.accountTargetingHistory.findMany({ where: { organizationId, accountType: SalesAccountType.AGENCY, externalAccountId: id }, orderBy: { changedAt: 'desc' }, take: 50 }),
    accountWorkAndEvents({ organizationId, accountType: 'AGENCY', accountId: agency.id, enabledFeatures }),
  ]);
  const storeContext = readStoreContext(overlay?.storeContext);
  const knownHours = readOperatingHoursDetails(agency.businessHours);
  const hoursResearchAvailable = getAccountResearchPilotAvailability().available;
  const actionUsers = users.map((user) => ({ id: user.id, name: getUserDisplayName(user) }));
  const userNames = new Map(users.map((entry) => [entry.id, getUserDisplayName(entry)]));

  const contacts = await prisma.locationContact.findMany({
    where: { organizationId, id: { in: visits.map((visit) => visit.contactId).filter(Boolean) as string[] } },
  });
  const contactMap = Object.fromEntries(contacts.map((contact) => [contact.id, contact.name]));
  const latestVisitAt = visits[0]?.visitAt;

  return (
    <>
      <header className="page-heading page-header account-workspace-heading">
        <div>
          <h1>{agency.name}</h1><p className="account-kind">Retail · {agency.city || 'Location not set'}</p><p className="account-location">{[agency.address, agency.city, agency.state, agency.zip].filter(Boolean).join(', ')}</p>
          {overlay?.isTargeting ? <p><strong className="target-account-marker">TARGET ACCOUNT</strong></p> : null}
          {agency.tags.length ? <TagBadges tags={agency.tags.map((assignment) => assignment.tag)} /> : null}
        </div>
        <div className="page-heading-actions"><ContextualActions
            context={{ accountName: agency.name, agencyId: agency.id, returnTo: `/agencies/${agency.id}`, sourceLabel: agency.name, sourceType: 'AGENCY_DETAIL' }}
            currentUserId={currentUser.id}
            users={actionUsers}
           variant="account" address={[agency.address, agency.city, agency.state, agency.zip].filter(Boolean).join(', ')} phone={agency.phone} secondaryActions={<>
          <TargetAccountControl accountType={SalesAccountType.AGENCY} externalAccountId={id} isTargeting={overlay?.isTargeting ?? false} allowStop returnTo={`/agencies/${id}`} />


          <Link className="btn compact-btn secondary" href={`/visits/new?type=agency&agencyId=${agency.id}&voice=1`}>Voice note</Link>

        </>} /></div>
      </header>
      {salesStatusSummary ? <AccountSalesStatusPanel accountType={SalesAccountType.AGENCY} externalAccountId={id} returnTo={`/agencies/${id}`} {...salesStatusSummary} /> : null}
      {query.status ? <p className="toast-notice" role="status">{statusMessages[query.status] ?? query.status}</p> : null}
      {query.tagStatus ? <p className="pill">{tagStatusMessages[query.tagStatus] ?? query.tagStatus}</p> : null}
      {query.memoryStatus ? <p className="toast-notice" role="status">{query.memoryStatus === 'notes-saved' ? 'Account notes saved.' : query.memoryStatus === 'contact-saved' ? 'Contact saved.' : 'Unable to save that account information.'}</p> : null}
      <AccountWorkspace key={agency.id} panels={[
{ id: 'overview', label: 'Overview', content: <>
      <AccountMemoryPanel users={actionUsers} accountId={agency.id} accountType="AGENCY" contacts={accountContacts} notes={overlay?.notes ?? null} returnTo={`/agencies/${agency.id}`} />

      <Suspense fallback={<section id="account-worklist" className="card account-workspace-section account-worklist" aria-busy="true"><h2>Outstanding work</h2><p role="status">Loading outstanding work…</p></section>}>
        <AccountWorklist accountId={agency.id} accountName={agency.name} accountType="AGENCY" currentUserId={currentUser.id} actorName={getUserDisplayName(currentUser)} organizationId={organizationId} enabledFeatures={enabledFeatures} />
      </Suspense>


<Suspense fallback={<p aria-busy="true" role="status">Loading account briefing…</p>}><AccountBriefing account={{ accountType: "AGENCY", accountId: agency.id }} actor={{ organizationId, userId: currentUser.id }} lastPurchaseAt={salesStatusSummary?.lastPurchaseAt} /></Suspense></> },
{ id: 'sales', label: 'Sales', content: <>
        <AgencyRecentSalesCard salesWindows={salesWindows} config={tenantConfig} />
      </> },
...(hasAgencyIntelligence || hasWholesaleOpportunities ? [{ id: 'intelligence', label: 'Intelligence', content: <>
            {hasAgencyIntelligence ? <AgencyStoreSummary context={storeContext} market={marketProfile} d8Permit={agency.d8Permit} county={agency.county} /> : null}

      {hasAgencyIntelligence ? <>
        <div className="retail-intelligence-content">
          <p className="retail-intelligence-intro muted">Next actions, what sells here, and the store behind the numbers.</p>
          <Suspense fallback={<p aria-busy="true" role="status">Loading retail intelligence…</p>}><AgencyIntelligencePanel agencyId={agency.id} agencyName={agency.name} currentUserId={currentUser.id} organizationId={organizationId} users={actionUsers} /></Suspense>
          <AgencyRetailMarketIntelligence market={marketProfile} fits={marketFits} />
          <AgencyStoreIntelligence agencyId={agency.id} context={storeContext} />
        </div>
      </> : null}
      {hasWholesaleOpportunities ? <section id="wholesale-intelligence"><h2>Linked restaurant opportunities</h2>
        <Suspense fallback={<p aria-busy="true" role="status">Loading linked restaurant intelligence…</p>}><OpportunityAccountPanel agencyId={agency.agencyId} currentUserId={currentUser.id} returnTo={`/agencies/${agency.id}`} users={actionUsers} /></Suspense>
      </section> : null}
    </> }] : []),
{ id: 'activity', label: 'Activity', content: <>      <section className="dashboard-section account-workspace-section">
        <div className="section-heading">
          <h2>Activity</h2>
          <span className="pill">{visits.length + communicationActivities.length + salesStatusHistory.length + targetingHistory.length + workAndEvents.length}</span>
        </div>

        <VisitActivityTable contactMap={contactMap} visits={visits} supplementalEvents={communicationActivities.map((activity): SupplementalActivity => ({
          actor: getUserDisplayName(activity.createdByUser),
          at: activity.occurredAt,
          detail: [activity.summary ?? (['EMAIL_INITIATED', 'CALL_INITIATED'].includes(activity.activityType) ? getCommunicationTitle(activity.activityType === 'EMAIL_INITIATED' ? 'EMAIL_INITIATED' : 'CALL_INITIATED', activity.contact?.name ?? 'Contact') : activity.contact?.name), activity.outcome, activity.visibility === 'PRIVATE' ? 'Only you' : null].filter(Boolean).join(' · '),
          id: activity.id,
          href: activity.createdByUserId === currentUser.id ? activity.externalUrl ?? "" : "",
          title: activityLabels[activity.activityType], type: activityLabels[activity.activityType], source: activity.source, contactIds: activity.contactIds.length ? activity.contactIds : activity.contactId ? [activity.contactId] : [],
        })).concat(salesStatusHistory.map((event) => ({
          actor: event.changedByUserId ? userNames.get(event.changedByUserId) ?? 'Former team member' : 'Neat',
          at: event.changedAt,
          detail: event.previousStatus ? `${SALES_STATUS_LABELS[event.previousStatus]} → ${SALES_STATUS_LABELS[event.newStatus]}` : `Set to ${SALES_STATUS_LABELS[event.newStatus]}`,
          id: `sales-status-${event.id}`,
          href: "",
          title: event.source === 'SALES_DATA' ? 'Purchase detected' : 'Sales status changed',
        }))).concat(targetingHistory.map((event) => ({
          actor: event.changedByUserId ? userNames.get(event.changedByUserId) ?? 'Former team member' : 'Neat',
          at: event.changedAt,
          detail: event.isTargeting ? 'TARGET ACCOUNT' : 'Targeting stopped',
          href: '',
          id: `targeting-${event.id}`,
          title: event.isTargeting ? 'Account targeted' : 'Targeting stopped',
        }))).concat(workAndEvents)} />
      </section></> },
{ id: 'account-details', label: 'Details', content: <><Suspense fallback={<section className="card" aria-busy="true"><p role="status">Loading account profile…</p></section>}><AccountProfile organizationId={organizationId} accountType="AGENCY" accountId={agency.id} /></Suspense>
      <div className="grid account-summary-grid account-workspace-section">
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
          <p><strong>Retail ID</strong><span>{agency.agencyId}</span></p>
          <p>
            <strong>Address</strong>
            <AddressLink address={[agency.address, agency.city, agency.state, agency.zip].filter(Boolean).join(', ')} />
          </p>
          <p>
            <strong>Primary contact</strong>
            <span>{agency.primaryContact}</span>
          </p>
          <p>
            <strong>Contact phone</strong>
            <PhoneLink phone={agency.primaryContactPhone} />
          </p>
          <p>
            <strong>Retail phone</strong>
            <PhoneLink phone={agency.phone} />
          </p>
          <AgencyOperatingHoursEditor agencyId={agency.id} {...knownHours} canEdit={isAdminRole(currentUser.role)} researchAvailable={hoursResearchAvailable} />
        </div>
        <AccountTagPanel
          assignments={agency.tags}
          locationId={agency.id}
          locationType="agency"
          returnTo={`/agencies/${agency.id}`}
          tags={tags}
        />
      </div>
      </> }
      ]} initialSection={query.tagStatus ? 'account-details' : 'overview'} />
    </>
  );
}
