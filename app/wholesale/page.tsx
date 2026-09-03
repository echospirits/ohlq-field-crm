export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountType, OpportunityStatus, Prisma } from '@prisma/client';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireUser } from '../../lib/auth';
import { formatEasternDate } from '../../lib/dateTime';
import { getGeocodeResetForAddressChange } from '../../lib/location/geocode';
import { prisma } from '../../lib/prisma';
import { getOrganizationFeatures, requireOrganizationContext } from '../../lib/organizations';
import {
  formatWholesaleLicenseeIds,
  getPrimaryWholesaleLicenseeId,
  getWholesaleLicenseeIdConflictWhere,
  getWholesaleLicenseeIdCreateData,
  getWholesaleLicenseeIdTextSearchWhere,
  getWholesaleLicenseeIdValues,
  normalizeWholesaleLicenseeId,
  parseWholesaleLicenseeIds,
  syncWholesaleAccountLicenseeIds,
} from '../../lib/wholesaleAccounts';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { AccountViewNavigation } from '../components/AccountViewNavigation';
import { NearbyAccountsSection } from '../components/NearbyAccountsSection';
import { activateOfficialWholesaleAccount } from './actions';

export const metadata = buildPageMetadata('Wholesale Accounts');

type SortDirection = 'asc' | 'desc';

type WholesaleSortKey =
  | 'actions'
  | 'licenseeIds'
  | 'name'
  | 'agencyId'
  | 'address'
  | 'city'
  | 'mostRecentVisit'
  | 'opportunityPriority'
  | 'opportunityScore'
  | 'nextAction';

type WholesalePageParams = {
  dir?: string;
  page?: string;
  q?: string;
  sort?: string;
  status?: string;
};

type WholesaleTableRow = {
  actionHref: string | null;
  actionLabel: string;
  address: string | null;
  agencyId: string | null;
  city: string | null;
  id: string;
  isOfficialCandidate: boolean;
  licenseeIdsText: string | null;
  mostRecentVisit: Date | null;
  name: string;
  nameHref: string | null;
  nextAction: string | null;
  opportunityPriority: string | null;
  opportunityScore: number | null;
};

const MAX_WHOLESALE_ACCOUNT_ROWS = 5000;
const WHOLESALE_PAGE_SIZE = 300;

const wholesaleSortColumns: Array<{ key: WholesaleSortKey; label: string }> = [
  { key: 'actions', label: 'Actions' },
  { key: 'licenseeIds', label: 'Licensee IDs' },
  { key: 'name', label: 'Name' },
  { key: 'agencyId', label: 'Agency ID' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'mostRecentVisit', label: 'Most Recent Visit' },
  { key: 'opportunityPriority', label: 'Opportunity Priority' },
  { key: 'opportunityScore', label: 'Opportunity Score' },
  { key: 'nextAction', label: 'Next Action' },
];

const numericSortKeys = new Set<WholesaleSortKey>([
  'opportunityScore',
  'opportunityPriority',
]);

const descendingDefaultSortKeys = new Set<WholesaleSortKey>([
  'mostRecentVisit',
  'opportunityScore',
]);

const opportunityPriorityRanks: Record<string, number> = {
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const toOptional = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const formatMetric = (value: number | null, suffix = '') => (value === null ? 'n/a' : `${value.toFixed(1)}${suffix}`);

const isWholesaleSortKey = (value: string | undefined, columns = wholesaleSortColumns): value is WholesaleSortKey =>
  columns.some((column) => column.key === value);

const getDefaultSortDirection = (sortKey: WholesaleSortKey): SortDirection =>
  descendingDefaultSortKeys.has(sortKey) ? 'desc' : 'asc';

const getSortDirection = (value: string | undefined, sortKey: WholesaleSortKey): SortDirection =>
  value === 'asc' || value === 'desc' ? value : getDefaultSortDirection(sortKey);

const getNextSortDirection = (
  sortKey: WholesaleSortKey,
  currentSortKey: WholesaleSortKey,
  currentSortDirection: SortDirection,
) => (sortKey === currentSortKey ? (currentSortDirection === 'asc' ? 'desc' : 'asc') : getDefaultSortDirection(sortKey));

const buildSortHref = ({
  currentSortDirection,
  currentSortKey,
  params,
  sortKey,
}: {
  currentSortDirection: SortDirection;
  currentSortKey: WholesaleSortKey;
  params: WholesalePageParams;
  sortKey: WholesaleSortKey;
}) => {
  const query = new URLSearchParams();
  const q = (params.q ?? '').trim();
  const status = (params.status ?? '').trim();

  if (q) query.set('q', q);
  if (status) query.set('status', status);

  query.set('sort', sortKey);
  query.set('dir', getNextSortDirection(sortKey, currentSortKey, currentSortDirection));

  return `/wholesale?${query.toString()}`;
};

const buildPageHref = ({
  page,
  params,
  sortDirection,
  sortKey,
}: {
  page: number;
  params: WholesalePageParams;
  sortDirection: SortDirection;
  sortKey: WholesaleSortKey;
}) => {
  const query = new URLSearchParams();
  const q = (params.q ?? '').trim();
  const status = (params.status ?? '').trim();

  if (q) query.set('q', q);
  if (status) query.set('status', status);

  query.set('sort', sortKey);
  query.set('dir', sortDirection);
  query.set('page', String(page));

  return `/wholesale?${query.toString()}`;
};

function SortableHeader({
  currentSortDirection,
  currentSortKey,
  label,
  params,
  sortKey,
}: {
  currentSortDirection: SortDirection;
  currentSortKey: WholesaleSortKey;
  label: string;
  params: WholesalePageParams;
  sortKey: WholesaleSortKey;
}) {
  const isActive = sortKey === currentSortKey;

  return (
    <th aria-sort={isActive ? (currentSortDirection === 'asc' ? 'ascending' : 'descending') : undefined}>
      <Link
        aria-label={`Sort by ${label} ${getNextSortDirection(sortKey, currentSortKey, currentSortDirection)}`}
        className={isActive ? 'sort-link active' : 'sort-link'}
        href={buildSortHref({ currentSortDirection, currentSortKey, params, sortKey })}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="sort-indicator">
          {isActive ? (currentSortDirection === 'asc' ? '^' : 'v') : ''}
        </span>
      </Link>
    </th>
  );
}

const compareText = (left: string | null | undefined, right: string | null | undefined, direction: SortDirection) => {
  const leftText = (left ?? '').trim();
  const rightText = (right ?? '').trim();

  if (!leftText && !rightText) return 0;
  if (!leftText) return 1;
  if (!rightText) return -1;

  const result = leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
};

const compareNumber = (left: number | null | undefined, right: number | null | undefined, direction: SortDirection) => {
  if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
  if (right === null || right === undefined) return -1;

  const result = left - right;
  return direction === 'asc' ? result : -result;
};

const compareDate = (left: Date | null, right: Date | null, direction: SortDirection) => {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const result = left.getTime() - right.getTime();
  return direction === 'asc' ? result : -result;
};

const getSortNumberValue = (row: WholesaleTableRow, sortKey: WholesaleSortKey) => {
  switch (sortKey) {
    case 'opportunityScore':
      return row.opportunityScore;
    case 'opportunityPriority':
      return row.opportunityPriority ? opportunityPriorityRanks[row.opportunityPriority.toUpperCase()] ?? 99 : null;
    default:
      return null;
  }
};

const getSortTextValue = (row: WholesaleTableRow, sortKey: WholesaleSortKey) => {
  switch (sortKey) {
    case 'actions':
      return row.actionLabel;
    case 'agencyId':
      return row.agencyId;
    case 'address':
      return row.address;
    case 'city':
      return row.city;
    case 'licenseeIds':
      return row.licenseeIdsText;
    case 'name':
      return row.name;
    case 'nextAction':
      return row.nextAction;
    default:
      return null;
  }
};

const sortWholesaleRows = (rows: WholesaleTableRow[], sortKey: WholesaleSortKey, direction: SortDirection) =>
  [...rows].sort((left, right) => {
    const primary =
      sortKey === 'mostRecentVisit'
        ? compareDate(left.mostRecentVisit, right.mostRecentVisit, direction)
        : numericSortKeys.has(sortKey)
          ? compareNumber(getSortNumberValue(left, sortKey), getSortNumberValue(right, sortKey), direction)
          : compareText(getSortTextValue(left, sortKey), getSortTextValue(right, sortKey), direction);

    return (
      primary ||
      compareText(left.name, right.name, 'asc') ||
      compareText(left.licenseeIdsText, right.licenseeIdsText, 'asc')
    );
  });

const getSelectedTagIds = (formData: FormData) =>
  Array.from(
    new Set(
      formData
        .getAll('tagId')
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  );

async function createWholesale(formData: FormData) {
  'use server';

  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const licenseeIds = parseWholesaleLicenseeIds(
    String(formData.get('licenseeIds') ?? formData.get('licenseeId') ?? ''),
  );
  const licenseeId = getPrimaryWholesaleLicenseeId(licenseeIds);
  const name = String(formData.get('name') ?? '').trim();

  if (!licenseeId || !name) {
    redirect('/wholesale?status=invalid');
  }

  const requestedTagIds = getSelectedTagIds(formData);
  const tagIds = requestedTagIds.length
    ? (await prisma.tag.findMany({ where: { id: { in: requestedTagIds }, organizationId }, select: { id: true } })).map((tag) => tag.id)
    : [];
  const matchingAccounts = await prisma.wholesaleAccount.findMany({
    where: getWholesaleLicenseeIdConflictWhere(licenseeIds),
    select: { id: true, address: true, city: true, state: true, zip: true },
    take: 2,
  });
  const matchingAccountIds = Array.from(new Set(matchingAccounts.map((account) => account.id)));

  if (matchingAccountIds.length > 1) {
    redirect('/wholesale?status=duplicate-licensee');
  }

  const officialAccount = await prisma.account.findFirst({
    where: {
      licenseeId: { equals: licenseeId, mode: 'insensitive' },
      type: AccountType.BAR_RESTAURANT,
    },
    select: { id: true },
  });
  const accountData = {
    isActive: true,
    name,
    officialAccountId: officialAccount?.id,
    agencyId: toOptional(String(formData.get('agencyId') ?? '')),
    address: toOptional(String(formData.get('address') ?? '')),
    city: toOptional(String(formData.get('city') ?? '')),
    county: toOptional(String(formData.get('county') ?? '')),
    zip: toOptional(String(formData.get('zip') ?? '')),
    phone: toOptional(String(formData.get('phone') ?? '')),
    ownership: toOptional(String(formData.get('ownership') ?? '')),
    districtId: toOptional(String(formData.get('districtId') ?? '')),
    deliveryDay: toOptional(String(formData.get('deliveryDay') ?? '')),
  };
  const account = await prisma.$transaction(async (tx) => {
    const existingAccountId = matchingAccountIds[0];

    if (existingAccountId) {
      const existingAccount = matchingAccounts.find((candidate) => candidate.id === existingAccountId);
      const updatedAccount = await tx.wholesaleAccount.update({
        where: { id: existingAccountId },
        data: {
          ...accountData,
          ...getGeocodeResetForAddressChange(existingAccount, {
            address: accountData.address,
            city: accountData.city,
            state: 'OH',
            zip: accountData.zip,
          }),
          licenseeId,
        },
        select: { id: true },
      });
      await syncWholesaleAccountLicenseeIds(tx, updatedAccount.id, licenseeIds);
      return updatedAccount;
    }

    return tx.wholesaleAccount.create({
      data: {
        ...accountData,
        licenseeId,
        licenseeIds: { create: getWholesaleLicenseeIdCreateData(licenseeIds) },
        createdByUserId: user.id,
      },
      select: { id: true },
    });
  });

  if (tagIds.length > 0) {
    await prisma.locationTag.createMany({
      data: tagIds.map((tagId) => ({
        organizationId,
        tagId,
        wholesaleAccountId: account.id,
        note: 'Applied from wholesale account form',
        createdByUserId: user.id,
      })),
      skipDuplicates: true,
    });
  }

  revalidatePath('/wholesale');
  revalidatePath('/tags');
  revalidatePath('/visits/new');
  redirect('/wholesale?status=saved');
}

const wholesaleSearchWhere = (q: string, organizationId: string, includeIntelligence: boolean): Prisma.WholesaleAccountWhereInput => ({
  OR: [
    { name: { contains: q, mode: 'insensitive' } },
    ...getWholesaleLicenseeIdTextSearchWhere(q),
    { agencyId: { contains: q, mode: 'insensitive' } },
    { address: { contains: q, mode: 'insensitive' } },
    { phone: { contains: q, mode: 'insensitive' } },
    { tags: { some: { organizationId, tag: { name: { contains: q, mode: 'insensitive' } } } } },
    { menuPlacements: { some: { organizationId, product: { contains: q, mode: 'insensitive' } } } },
    { menuPlacements: { some: { organizationId, menuItemName: { contains: q, mode: 'insensitive' } } } },
    ...(includeIntelligence ? [
      { opportunities: { some: { organizationId, title: { contains: q, mode: 'insensitive' as const } } } },
      { opportunities: { some: { organizationId, recommendedAction: { contains: q, mode: 'insensitive' as const } } } },
      { opportunities: { some: { organizationId, targetCategory: { contains: q, mode: 'insensitive' as const } } } },
    ] : []),
  ],
});

const officialWholesaleSearchWhere = (q: string): Prisma.AccountWhereInput => ({
  licenseeId: { not: null },
  type: AccountType.BAR_RESTAURANT,
  OR: [
    { name: { contains: q, mode: 'insensitive' } },
    { licenseeId: { contains: q, mode: 'insensitive' } },
    { agencyRefId: { contains: q, mode: 'insensitive' } },
    { address: { contains: q, mode: 'insensitive' } },
    { city: { contains: q, mode: 'insensitive' } },
    { phone: { contains: q, mode: 'insensitive' } },
  ],
});

export default async function WholesalePage({
  searchParams,
}: {
  searchParams?: Promise<WholesalePageParams>;
}) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const enabledFeatures = await getOrganizationFeatures(organizationId);
  const hasWholesaleOpportunities = enabledFeatures.has('WHOLESALE_OPPORTUNITIES');
  const visibleSortColumns = hasWholesaleOpportunities
    ? wholesaleSortColumns
    : wholesaleSortColumns.filter((column) => !['opportunityPriority', 'opportunityScore', 'nextAction'].includes(column.key));

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();
  const sortKey = isWholesaleSortKey(params.sort, visibleSortColumns) ? params.sort : 'name';
  const sortDirection = getSortDirection(params.dir, sortKey);
  const requestedPage = Number.parseInt(params.page ?? '1', 10);
  const accountWhere: Prisma.WholesaleAccountWhereInput = {
    isActive: true,
    ...(q ? wholesaleSearchWhere(q, organizationId, hasWholesaleOpportunities) : {}),
  };

  const [accounts, tags, officialCandidates] = await Promise.all([
    prisma.wholesaleAccount.findMany({
      take: MAX_WHOLESALE_ACCOUNT_ROWS,
      where: accountWhere,
      include: {
        licenseeIds: {
          orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }],
          select: { licenseeId: true },
        },
      },
      orderBy: [{ name: 'asc' }, { licenseeId: 'asc' }],
    }),
    prisma.tag.findMany({ where: { organizationId }, orderBy: [{ name: 'asc' }] }),
    q
      ? prisma.account.findMany({
          where: officialWholesaleSearchWhere(q),
          orderBy: [{ name: 'asc' }, { licenseeId: 'asc' }],
          take: 40,
          select: {
            id: true,
            licenseeId: true,
            agencyRefId: true,
            name: true,
            address: true,
            city: true,
          },
        })
      : [],
  ]);
  const candidateLicenseeIds = officialCandidates
    .map((account) => normalizeWholesaleLicenseeId(account.licenseeId))
    .filter(Boolean) as string[];
  const linkedWholesaleAccounts =
    candidateLicenseeIds.length > 0
      ? await prisma.wholesaleAccount.findMany({
          where: {
            OR: [
              ...candidateLicenseeIds.map((licenseeId) => ({
                licenseeId: { equals: licenseeId, mode: 'insensitive' as const },
              })),
              {
                licenseeIds: {
                  some: {
                    OR: candidateLicenseeIds.map((licenseeId) => ({
                      licenseeId: { equals: licenseeId, mode: 'insensitive' as const },
                    })),
                  },
                },
              },
            ],
          },
          select: {
            licenseeId: true,
            licenseeIds: { select: { licenseeId: true } },
          },
        })
      : [];
  const linkedLicenseeIds = new Set(
    linkedWholesaleAccounts.flatMap((account) => getWholesaleLicenseeIdValues(account)),
  );
  const officialAccounts = officialCandidates.filter((account) => {
    const licenseeId = normalizeWholesaleLicenseeId(account.licenseeId);
    return licenseeId && !linkedLicenseeIds.has(licenseeId);
  });
  const accountIds = accounts.map((account) => account.id);
  const [visitStats, opportunities] =
    accountIds.length > 0
      ? await Promise.all([
          prisma.loggedVisit.groupBy({
            by: ['wholesaleAccountId'],
            where: {
              organizationId,
              locationType: 'wholesale',
              wholesaleAccountId: { in: accountIds },
            },
            _max: { visitAt: true },
          }),
          hasWholesaleOpportunities ? prisma.salesOpportunity.findMany({
            where: {
              organizationId,
              wholesaleAccountId: { in: accountIds },
              status: { in: [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED, OpportunityStatus.SNOOZED] },
            },
            orderBy: [{ productionScore: 'desc' }, { lastDetectedAt: 'desc' }],
            select: {
              wholesaleAccountId: true,
              priorityBand: true,
              productionScore: true,
              recommendedAction: true,
            },
          }) : Promise.resolve([]),
        ])
      : [[], []];
  const visitStatMap = Object.fromEntries(
    visitStats.map((stat) => [
      stat.wholesaleAccountId ?? '',
      stat._max.visitAt,
    ]),
  );
  const opportunityMap = new Map<string, (typeof opportunities)[number]>();
  opportunities.forEach((opportunity) => {
    if (!opportunityMap.has(opportunity.wholesaleAccountId)) opportunityMap.set(opportunity.wholesaleAccountId, opportunity);
  });
  const activeRows: WholesaleTableRow[] = accounts.map((account) => {
    const lastVisitAt = visitStatMap[account.id] ?? null;
    const opportunity = opportunityMap.get(account.id) ?? null;

    return {
      actionHref: `/visits/new?type=wholesale&wholesaleAccountId=${account.id}`,
      actionLabel: 'Log visit',
      address: account.address,
      agencyId: account.agencyId,
      city: account.city,
      id: account.id,
      isOfficialCandidate: false,
      licenseeIdsText: formatWholesaleLicenseeIds(account),
      mostRecentVisit: lastVisitAt,
      name: account.name,
      nameHref: `/wholesale/${account.id}`,
      nextAction: opportunity?.recommendedAction ?? null,
      opportunityPriority: opportunity?.priorityBand ?? null,
      opportunityScore: opportunity?.productionScore ?? null,
    };
  });
  const officialRows: WholesaleTableRow[] = officialAccounts.map((account) => ({
    actionHref: null,
    actionLabel: 'Activate',
    address: account.address,
    agencyId: account.agencyRefId,
    city: account.city,
    id: account.id,
    isOfficialCandidate: true,
    licenseeIdsText: account.licenseeId,
    mostRecentVisit: null,
    name: account.name,
    nameHref: null,
    nextAction: null,
    opportunityPriority: null,
    opportunityScore: null,
  }));
  const sortedRows = sortWholesaleRows([...activeRows, ...officialRows], sortKey, sortDirection);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / WHOLESALE_PAGE_SIZE));
  const currentPage = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), totalPages);
  const startIndex = (currentPage - 1) * WHOLESALE_PAGE_SIZE;
  const tableRows = sortedRows.slice(startIndex, startIndex + WHOLESALE_PAGE_SIZE);
  const firstRowNumber = sortedRows.length > 0 ? startIndex + 1 : 0;
  const lastRowNumber = Math.min(startIndex + WHOLESALE_PAGE_SIZE, sortedRows.length);

  return (
    <>
      <header className="page-heading page-header">
        <div>
          <span className="page-eyebrow">Accounts</span>
          <h1>Wholesale Accounts</h1>
          <p className="muted">Active accounts by default. Search also checks inactive official OHLQ records.</p>
        </div>
      </header>
      <AccountViewNavigation active="wholesale" />
      {!q ? <NearbyAccountsSection type="wholesale" /> : null}

      <LiveFilterForm className="filter-form narrow-filter" label="Filter wholesale accounts">
        <input name="q" defaultValue={q} placeholder="Filter name, licensee ID, menu placement, phone" />
        <input name="page" type="hidden" value="1" />
        <label>Sort by</label>
        <select name="sort" defaultValue={sortKey}>
          {visibleSortColumns.map((column) => (
            <option key={column.key} value={column.key}>
              {column.label}
            </option>
          ))}
        </select>
        <label>Direction</label>
        <select name="dir" defaultValue={sortDirection}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </LiveFilterForm>
      {params.status === 'saved' ? <p className="pill">Wholesale account saved.</p> : null}
      {params.status === 'invalid' ? <p className="pill">Name and at least one Licensee ID are required.</p> : null}
      {params.status === 'duplicate-licensee' ? (
        <p className="pill">Those Licensee IDs are already split across multiple wholesale accounts.</p>
      ) : null}
      {params.status === 'invalid-official' ? <p className="pill">Select a valid official wholesale record.</p> : null}

      <details className="card compact-details admin-panel">
        <summary>Create non-official wholesale account</summary>
        <form action={createWholesale}>
          <div className="form-grid">
            <textarea name="licenseeIds" placeholder="Licensee IDs" required rows={3} />
            <input name="name" placeholder="Name" required />
            <input name="phone" placeholder="Phone" />
            <input name="city" placeholder="City" />
          </div>
          <details className="compact-details nested-details">
            <summary>More account details</summary>
            <div className="form-grid">
              <input name="agencyId" placeholder="Agency ID" />
              <input name="address" placeholder="Address" />
              <input name="county" placeholder="County" />
              <input name="zip" placeholder="Zip" />
              <input name="ownership" placeholder="Ownership" />
              <input name="districtId" placeholder="District ID" />
              <input name="deliveryDay" placeholder="Delivery Day" />
            </div>
          </details>
          {tags.length > 0 ? (
            <details className="compact-details nested-details">
              <summary>Tags</summary>
              <div className="tag-checkbox-grid">
                {tags.map((tag) => (
                  <label className="tag-checkbox" key={tag.id}>
                    <input name="tagId" type="checkbox" value={tag.id} />
                    <span className="tag-swatch" style={{ backgroundColor: tag.color ?? '#7c9cff' }} />
                    <span>{tag.name}</span>
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <button type="submit">Save wholesale account</button>
        </form>
      </details>

      <div className="section-heading">
        <h2>Accounts</h2>
        <span className="pill">{sortedRows.length}</span>
        <span className="pill">
          {firstRowNumber}-{lastRowNumber}
        </span>
      </div>

      <div className="table-scroll wholesale-table-scroll">
        <table className="responsive-table">
          <thead>
            <tr>
              {visibleSortColumns.map((column) => (
                <SortableHeader
                  currentSortDirection={sortDirection}
                  currentSortKey={sortKey}
                  key={column.key}
                  label={column.label}
                  params={params}
                  sortKey={column.key}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr className={row.isOfficialCandidate ? 'inactive-official-row' : undefined} key={row.id}>
                <td data-label="Actions">
                  {row.actionHref ? (
                    <Link className="btn compact-btn" href={row.actionHref}>
                      {row.actionLabel}
                    </Link>
                  ) : (
                    <form action={activateOfficialWholesaleAccount}>
                      <input name="officialAccountId" type="hidden" value={row.id} />
                      <button className="compact-btn secondary" type="submit">
                        {row.actionLabel}
                      </button>
                    </form>
                  )}
                </td>
                <td data-label="Licensee IDs">{row.licenseeIdsText}</td>
                <td data-label="Name">
                  {row.nameHref ? (
                    <Link className="table-link" href={row.nameHref}>
                      {row.name}
                    </Link>
                  ) : (
                    <form action={activateOfficialWholesaleAccount} className="inline-activate-form">
                      <input name="officialAccountId" type="hidden" value={row.id} />
                      <button className="link-button table-link" type="submit">
                        {row.name}
                      </button>
                    </form>
                  )}
                </td>
                <td data-label="Agency ID">{row.agencyId}</td>
                <td data-label="Address">{row.address}</td>
                <td data-label="City">{row.city}</td>
                <td data-label="Most Recent Visit">{formatEasternDate(row.mostRecentVisit)}</td>
                {hasWholesaleOpportunities ? <><td data-label="Opportunity Priority">
                  {row.opportunityPriority ? <span className={`priority priority-${row.opportunityPriority.toLowerCase()}`}>{row.opportunityPriority}</span> : <span className="muted">None active</span>}
                </td>
                <td data-label="Opportunity Score">{formatMetric(row.opportunityScore)}</td>
                <td data-label="Next Action">{row.nextAction ?? '—'}</td>
                </> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <div className="pagination-row">
          {currentPage > 1 ? (
            <Link
              className="btn compact-btn secondary"
              href={buildPageHref({ page: currentPage - 1, params, sortDirection, sortKey })}
            >
              Previous
            </Link>
          ) : (
            <span className="pill">Previous</span>
          )}
          <span className="muted">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link
              className="btn compact-btn secondary"
              href={buildPageHref({ page: currentPage + 1, params, sortDirection, sortKey })}
            >
              Next
            </Link>
          ) : (
            <span className="pill">Next</span>
          )}
        </div>
      ) : null}
      {q && sortedRows.length === 0 ? (
        <p className="muted activity-empty">No active or official wholesale accounts match that search.</p>
      ) : null}
    </>
  );
}
