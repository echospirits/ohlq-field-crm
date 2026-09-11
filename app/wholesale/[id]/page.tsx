export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { MenuPlacementStatus, MenuPlacementType, Prisma, UserRole, WholesaleOrderFiledSource, WholesaleOrderStatus } from '@prisma/client';
import { buildPageMetadata } from '../../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { formatDateOnly, formatEasternDate } from '../../../lib/dateTime';
import { getWholesaleRecentPurchases } from '../../../lib/ohlqSalesData';
import { prisma } from '../../../lib/prisma';
import { getOrganizationFeatures, requireOrganizationContext } from '../../../lib/organizations';
import { getOrganizationTenantConfig } from '../../../lib/tenantConfig';
import { isAdminRole } from '../../../lib/userAccess';
import { formatWholesaleLicenseeIds, getWholesaleLicenseeIdValues } from '../../../lib/wholesaleAccounts';
import { MenuPlacementPanel } from '../../menu-placements/MenuPlacementPanel';
import { AccountTagPanel } from '../../tags/AccountTagPanel';
import { TagBadges } from '../../tags/TagBadges';
import { VisitActivityTable } from '../../visits/VisitActivityTable';
import { WholesaleRecentPurchasesCard } from '../WholesaleRecentPurchasesCard';
import { AccountWorkspaceNavigation } from '../../components/AccountWorkspaceNavigation';
import { OpportunityAccountPanel } from '../OpportunityAccountPanel';
import { ContextualActions } from '../../components/ContextualActions';
import { listWholesaleOrders } from '../../../lib/wholesaleOrders';
import { formatOrderCurrency } from '../../wholesale-orders/orderPresentation';
import { AccountMemoryPanel } from '../../account-memory/AccountMemoryPanel';
import { getCommunicationTitle } from '../../../lib/accountMemory';

const formatVisitDate = (date: Date | null | undefined) => formatEasternDate(date) || 'No visits yet';
const getMergedWholesaleAccountIds = async (accountId: string) => {
  const ids = new Set([accountId]);
  let frontier = [accountId];
  while (frontier.length) {
    const sources = await prisma.wholesaleAccount.findMany({ where: { mergedIntoId: { in: frontier } }, select: { id: true } });
    frontier = sources.map(({ id: sourceId }) => sourceId).filter((sourceId) => !ids.has(sourceId));
    frontier.forEach((sourceId) => ids.add(sourceId));
  }
  return [...ids];
};
const tagStatusMessages: Record<string, string> = {
  added: 'Tag added.',
  removed: 'Tag removed.',
  invalid: 'Select a valid tag.',
};
const statusMessages: Record<string, string> = {
  updated: 'Wholesale account updated.',
  merged: 'Accounts merged successfully. Activity from the manual account is now shown here.',
  'visit-logged': 'Visit logged.',
  'visit-logged-photo-upload-failed': 'Visit logged, but one or more photos could not be uploaded.',
  'visit-logged-worklist-completed': 'Visit logged and worklist item completed.',
};
const menuPlacementStatusMessages: Record<string, string> = {
  created: 'Menu placement saved.',
  updated: 'Menu placement updated.',
  deleted: 'Menu placement deleted.',
  invalid: 'Product and menu item are required.',
  'invalid-photo': 'Proof uploads must be image files.',
  'photo-too-large': 'Each proof upload must be 5 MB or smaller.',
  'storage-not-configured': 'Photo object storage is not configured yet.',
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await prisma.wholesaleAccount.findUnique({ where: { id }, select: { name: true } });
  return buildPageMetadata(account?.name ?? 'Wholesale Account');
}

export default async function WholesaleActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    status?: string;
    tagStatus?: string;
    placementStatus?: string;
    placementQ?: string;
    placementStatusFilter?: string;
    placementTypeFilter?: string;
    memoryStatus?: string;
  }>;
}) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const enabledFeatures = await getOrganizationFeatures(organizationId);
  const hasWholesaleOpportunities = enabledFeatures.has('WHOLESALE_OPPORTUNITIES');
  const hasDirectWholesaleOrders = enabledFeatures.has('OHIO_DIRECT_WHOLESALE_ORDERS');
  const tenantConfig = await getOrganizationTenantConfig(organizationId);
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const account = await prisma.wholesaleAccount.findUnique({
    where: { id },
    include: {
      tags: {
        where: { organizationId },
        include: {
          tag: true,
          createdByUser: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      licenseeIds: {
        orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }],
        select: { licenseeId: true },
      },
    },
  });

  if (!account) {
    notFound();
  }
  if (account.mergedIntoId) {
    redirect(`/wholesale/${account.mergedIntoId}`);
  }

  const accountLicenseeIds = getWholesaleLicenseeIdValues(account);
  const mergedAccountIds = await getMergedWholesaleAccountIds(account.id);

  const [visits, tags, backingAccount, linkedAgency, users, purchases, accountOrders, overlay, accountContacts, communicationActivities] = await Promise.all([
    prisma.loggedVisit.findMany({
      where: {
        organizationId,
        wholesaleAccountId: id,
        locationType: 'wholesale',
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
    prisma.account.findFirst({
      where: {
        OR: accountLicenseeIds.map((licenseeId) => ({
          licenseeId: { equals: licenseeId, mode: 'insensitive' as const },
        })),
      },
      select: { id: true },
    }),
    account.agencyId
      ? prisma.agency.findFirst({
          where: { agencyId: { equals: account.agencyId, mode: 'insensitive' } },
          select: { id: true },
        })
      : null,
    prisma.user.findMany({ where: { organizationId }, orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
    getWholesaleRecentPurchases({ account, config: tenantConfig }),
    hasDirectWholesaleOrders ? listWholesaleOrders({ organizationId, wholesaleAccountIds: mergedAccountIds, status: WholesaleOrderStatus.FILED, pageSize: 200 }) : { orders: [], totalCount: 0, page: 1, pageSize: 200 },
    prisma.organizationAccountOverlay.findUnique({
      where: { organizationId_accountType_externalAccountId: { organizationId, accountType: 'WHOLESALE', externalAccountId: id } },
      select: { notes: true },
    }),
    prisma.locationContact.findMany({
      where: { organizationId, wholesaleAccountId: id },
      orderBy: [{ active: 'desc' }, { isPrimary: 'desc' }, { name: 'asc' }],
    }),
    prisma.accountActivity.findMany({
      where: { organizationId, wholesaleAccountId: id },
      include: { contact: { select: { name: true } }, createdByUser: { select: { email: true, name: true } } },
      orderBy: { occurredAt: 'desc' }, take: 50,
    }),
  ]);
  const filedOrders = accountOrders.orders.filter((order) => order.status === WholesaleOrderStatus.FILED && order.filedAt);
  const placementQ = (query.placementQ ?? '').trim();
  const placementStatusFilter = Object.values(MenuPlacementStatus).includes(
    query.placementStatusFilter as MenuPlacementStatus,
  )
    ? (query.placementStatusFilter as MenuPlacementStatus)
    : '';
  const placementTypeFilter = Object.values(MenuPlacementType).includes(
    query.placementTypeFilter as MenuPlacementType,
  )
    ? (query.placementTypeFilter as MenuPlacementType)
    : '';
  const placementLocationWhere: Prisma.MenuPlacementWhereInput[] = [{ wholesaleAccountId: id }];

  if (backingAccount) {
    placementLocationWhere.push({ accountId: backingAccount.id });
  }

  const menuPlacementWhere: Prisma.MenuPlacementWhereInput = {
    organizationId,
    OR: placementLocationWhere,
  };

  if (placementStatusFilter) {
    menuPlacementWhere.status = placementStatusFilter;
  }

  if (placementTypeFilter) {
    menuPlacementWhere.placementType = placementTypeFilter;
  }

  if (placementQ) {
    menuPlacementWhere.AND = [
      {
        OR: [
          { product: { contains: placementQ, mode: 'insensitive' } },
          { menuItemName: { contains: placementQ, mode: 'insensitive' } },
          { notes: { contains: placementQ, mode: 'insensitive' } },
          { assignedToUser: { email: { contains: placementQ, mode: 'insensitive' } } },
          { assignedToUser: { name: { contains: placementQ, mode: 'insensitive' } } },
        ],
      },
    ];
  }

  const [menuPlacements, legacyVisits] = await Promise.all([
    prisma.menuPlacement.findMany({
      where: menuPlacementWhere,
      include: {
        assignedToUser: true,
        createdByUser: true,
        updatedByUser: true,
      },
      orderBy: [{ status: 'asc' }, { lastVerifiedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 300,
    }),
    backingAccount
      ? prisma.visit.findMany({
          where: { accountId: backingAccount.id },
          orderBy: [{ visitDate: 'desc' }],
          take: 50,
          select: {
            id: true,
            visitDate: true,
            summary: true,
          },
        })
      : [],
  ]);

  const contacts = await prisma.locationContact.findMany({
    where: { organizationId, id: { in: visits.map((visit) => visit.contactId).filter(Boolean) as string[] } },
  });
  const contactMap = Object.fromEntries(contacts.map((contact) => [contact.id, contact.name]));
  const latestVisitAt = visits[0]?.visitAt;
  const actionUsers = users.filter((activeUser) => activeUser.isActive && activeUser.role !== UserRole.TASTER).map((activeUser) => ({ id: activeUser.id, name: getUserDisplayName(activeUser) }));

  return (
    <>
      <header className="page-heading page-header account-workspace-heading">
        <div>
          <span className="page-eyebrow">Licensee IDs {formatWholesaleLicenseeIds(account)}</span>
          <h1>{account.name}</h1>
          <TagBadges tags={account.tags.map((assignment) => assignment.tag)} />
        </div>
        <div className="page-heading-actions">
          {hasDirectWholesaleOrders ? <Link className="btn compact-btn" href={`/wholesale/${account.id}/direct-order`}>Create Direct Wholesale Order</Link> : null}
          <ContextualActions
            address={[account.address, account.city, account.state, account.zip].filter(Boolean).join(', ')}
            context={{ accountName: account.name, returnTo: `/wholesale/${account.id}`, sourceLabel: account.name, sourceType: 'WHOLESALE_DETAIL', wholesaleAccountId: account.id }}
            currentUserId={user.id}
            phone={account.phone}
            users={actionUsers}
          />
          <Link className="btn compact-btn secondary" href={`/visits/new?type=wholesale&wholesaleAccountId=${account.id}&voice=1`}>Voice note</Link>
          <Link className="btn compact-btn secondary" href={`/wholesale/${account.id}/edit`}>Edit</Link>
          {isAdminRole(user.role) && !account.officialAccountId ? (
            <Link className="btn compact-btn secondary" href={`/wholesale/${account.id}/merge`}>Merge account</Link>
          ) : null}
        </div>
      </header>
      {query.status ? <p className="toast-notice" role="status">{statusMessages[query.status] ?? query.status}</p> : null}
      {query.tagStatus ? <p className="pill">{tagStatusMessages[query.tagStatus] ?? query.tagStatus}</p> : null}
      {query.memoryStatus ? <p className="toast-notice" role="status">{query.memoryStatus === 'notes-saved' ? 'Account notes saved.' : query.memoryStatus === 'contact-saved' ? 'Contact saved.' : 'Unable to save that account information.'}</p> : null}
      {query.placementStatus ? (
        <p className="pill">{menuPlacementStatusMessages[query.placementStatus] ?? query.placementStatus}</p>
      ) : null}
      <AccountWorkspaceNavigation sections={[
        { href: '#overview', label: 'Overview' },
        { href: '#account-memory', label: 'Notes + contacts' },
        { href: '#placements', label: 'Placements' },
        { href: '#purchases', label: 'Purchases' },
        ...(hasWholesaleOpportunities ? [{ href: '#intelligence', label: 'Intelligence' }] : []),
        { href: '#activity', label: 'Activity' },
      ]} />

      <AccountMemoryPanel accountId={account.id} accountType="WHOLESALE" contacts={accountContacts} notes={overlay?.notes ?? null} returnTo={`/wholesale/${account.id}`} />

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
            <span>{[account.address, account.city, account.state, account.zip].filter(Boolean).join(', ')}</span>
          </p>
          <p>
            <strong>Agency ID</strong>
            <span>{linkedAgency ? <Link href={`/agencies/${linkedAgency.id}`}>{account.agencyId}</Link> : account.agencyId}</span>
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

      <div className="account-workspace-section" id="placements">
        <MenuPlacementPanel
          accountId={backingAccount?.id ?? null}
          filters={{
            q: placementQ,
            status: placementStatusFilter,
            placementType: placementTypeFilter,
          }}
          placements={menuPlacements}
          returnTo={`/wholesale/${account.id}`}
          users={users}
          visits={legacyVisits}
          wholesaleAccountId={account.id}
        />
      </div>

      <div className="account-workspace-section" id="purchases">
        <WholesaleRecentPurchasesCard purchases={purchases} />
      </div>

      {hasWholesaleOpportunities ? <div className="account-workspace-section" id="intelligence">
        <OpportunityAccountPanel wholesaleAccountId={account.id} currentUserId={user.id} returnTo={`/wholesale/${account.id}`} users={actionUsers} />
      </div> : null}

      <section className="dashboard-section account-workspace-section" id="activity">
        <div className="section-heading">
          <h2>Activity</h2>
          <span className="pill">{visits.length + filedOrders.length + communicationActivities.length}</span>
        </div>
        <VisitActivityTable contactMap={contactMap} visits={visits} supplementalEvents={filedOrders.map((order) => ({
          actor: order.filedSource === WholesaleOrderFiledSource.MANUAL ? order.filedBy?.displayName : 'OHLQ sales match',
          at: order.filedAt!,
          detail: `${formatDateOnly(order.saleDate)} · ${formatOrderCurrency(order.totalCents)} · ${order.lines.length} item${order.lines.length === 1 ? '' : 's'}`,
          href: `/wholesale-orders/${order.id}`,
          id: order.id,
          title: 'Direct wholesale order filed',
        })).concat(communicationActivities.map((activity) => ({
          actor: getUserDisplayName(activity.createdByUser), at: activity.occurredAt,
          detail: getCommunicationTitle(activity.activityType, activity.contact.name), id: activity.id,
          href: '',
          title: activity.activityType === 'EMAIL_INITIATED' ? 'Email initiated' : 'Call initiated',
        })))} />
      </section>
    </>
  );
}
