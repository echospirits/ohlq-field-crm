export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MenuPlacementStatus, MenuPlacementType, Prisma } from '@prisma/client';
import { requireUser } from '../../../lib/auth';
import { formatEasternDate } from '../../../lib/dateTime';
import { getWholesaleRecentPurchases } from '../../../lib/ohlqSalesData';
import { prisma } from '../../../lib/prisma';
import { formatWholesaleLicenseeIds, getWholesaleLicenseeIdValues } from '../../../lib/wholesaleAccounts';
import { MenuPlacementPanel } from '../../menu-placements/MenuPlacementPanel';
import { AccountTagPanel } from '../../tags/AccountTagPanel';
import { TagBadges } from '../../tags/TagBadges';
import { VisitActivityTable } from '../../visits/VisitActivityTable';
import { WholesaleRecentPurchasesCard } from '../WholesaleRecentPurchasesCard';

const formatVisitDate = (date: Date | null | undefined) => formatEasternDate(date) || 'No visits yet';
const tagStatusMessages: Record<string, string> = {
  added: 'Tag added.',
  removed: 'Tag removed.',
  invalid: 'Select a valid tag.',
};
const statusMessages: Record<string, string> = {
  updated: 'Wholesale account updated.',
  activated: 'Account activated.',
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
  }>;
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
      licenseeIds: {
        orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }],
        select: { licenseeId: true },
      },
    },
  });

  if (!account) {
    notFound();
  }

  const accountLicenseeIds = getWholesaleLicenseeIdValues(account);

  const [visits, tags, backingAccount, users, purchases] = await Promise.all([
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
    prisma.account.findFirst({
      where: {
        OR: accountLicenseeIds.map((licenseeId) => ({
          licenseeId: { equals: licenseeId, mode: 'insensitive' as const },
        })),
      },
      select: { id: true },
    }),
    prisma.user.findMany({ orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
    getWholesaleRecentPurchases({ account }),
  ]);
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
    where: { id: { in: visits.map((visit) => visit.contactId).filter(Boolean) as string[] } },
  });
  const contactMap = Object.fromEntries(contacts.map((contact) => [contact.id, contact.name]));
  const latestVisitAt = visits[0]?.visitAt;

  return (
    <>
      <div className="page-actions">
        <Link href="/wholesale">Back to wholesale accounts</Link>
        <Link className="btn compact-btn" href={`/visits/new?type=wholesale&wholesaleAccountId=${account.id}`}>
          Log visit
        </Link>
        <Link className="btn compact-btn secondary" href={`/visits/new?type=wholesale&wholesaleAccountId=${account.id}&voice=1`}>
          Voice note
        </Link>
        <Link className="btn compact-btn secondary" href={`/wholesale/${account.id}/edit`}>
          Edit
        </Link>
      </div>

      <h1>{account.name}</h1>
      <p className="muted">Licensee IDs {formatWholesaleLicenseeIds(account)}</p>
      {!account.isActive ? <p className="pill">Inactive</p> : null}
      {query.status ? <p className="toast-notice" role="status">{statusMessages[query.status] ?? query.status}</p> : null}
      {query.tagStatus ? <p className="pill">{tagStatusMessages[query.tagStatus] ?? query.tagStatus}</p> : null}
      {query.placementStatus ? (
        <p className="pill">{menuPlacementStatusMessages[query.placementStatus] ?? query.placementStatus}</p>
      ) : null}
      <TagBadges tags={account.tags.map((assignment) => assignment.tag)} />

      <div className="grid account-summary-grid">
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

      <WholesaleRecentPurchasesCard purchases={purchases} />

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
