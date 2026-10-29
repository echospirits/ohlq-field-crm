import { CommercialOpportunityStars } from '../components/CommercialOpportunityStars';
import { evidenceModeLabel, type EvidenceMode } from '../../lib/wholesaleAssessment';
import { AddressLink } from '../components/AccountContactLinks';
﻿export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SubmitButton } from '../components/SubmitButton';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '../components/ActionForm';
import { WholesaleAddressFields } from '../components/WholesaleAddressFields';
import { normalizeUsState, stateScopedLicenseeIds } from '../../lib/usStates';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountType, OpportunityStatus, Prisma } from '@prisma/client';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireUser } from '../../lib/auth';
import { getDirectionsHref } from '../../lib/crmActionContext';
import { formatEasternDate } from '../../lib/dateTime';
import { getWholesaleAddressProtectionForEdit } from '../../lib/wholesaleAddressProtection';
import { prisma } from '../../lib/prisma';
import { getOrganizationFeatures, requireOrganizationContext } from '../../lib/organizations';
import {
  formatWholesaleLicenseeIds,
  getPrimaryWholesaleLicenseeId,
  getWholesaleLicenseeIdConflictWhere,
  getWholesaleLicenseeIdCreateData,
  getWholesaleLicenseeIdTextSearchWhere,
  parseWholesaleLicenseeIds,
} from '../../lib/wholesaleAccounts';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { AccountViewNavigation } from '../components/AccountViewNavigation';
import { NearbyAccountsSection } from '../components/NearbyAccountsSection';
import { TargetAccountMarker } from '../components/TargetAccountMarker';
import { readWholesaleDirectory } from '../../lib/wholesaleDirectory';
import { directoryPage, DIRECTORY_PAGE_SIZE } from '../../lib/directoryPagination';
import { DirectoryPagination } from '../components/DirectoryPagination';
import { AnchoredDetails } from '../components/AnchoredDetails';

export const metadata = buildPageMetadata('Restaurant Accounts');

type SortDirection = 'asc' | 'desc';

type WholesaleSortKey =
  | 'actions'
  | 'licenseeIds'
  | 'name'
  | 'agencyId'
  | 'address'
  | 'city'
  | 'mostRecentVisit'
  | 'commercialRating'
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
  licenseeIdsText: string | null;
  mostRecentVisit: Date | null;
  name: string;
  nameHref: string | null;
  nextAction: string | null;
  commercialRating: number | null;
  evidenceMode?: string;
  assessmentStatus?: string;
  pending?: boolean;
  stale?: boolean;
  phone: string | null;
  directionsHref: string | null;
  locationText: string | null;
};

const WHOLESALE_PAGE_SIZE = DIRECTORY_PAGE_SIZE;

const wholesaleSortColumns: Array<{ key: WholesaleSortKey; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'licenseeIds', label: 'Licensee IDs' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'agencyId', label: 'Retail ID' },
  { key: 'mostRecentVisit', label: 'Most Recent Visit' },
  { key: 'commercialRating', label: 'Commercial opportunity' },
  { key: 'nextAction', label: 'Next Action' },
  { key: 'actions', label: 'Actions' },
];

const numericSortKeys = new Set<WholesaleSortKey>([
  'commercialRating',
]);

const descendingDefaultSortKeys = new Set<WholesaleSortKey>([
  'mostRecentVisit',
  'commercialRating',
]);

const toOptional = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

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
    case 'commercialRating':
      return row.commercialRating;
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
  const { organizationId, organization } = await requireOrganizationContext(user);
  const state = normalizeUsState(String(formData.get('state') ?? 'OH'));
  if (!state) return { error: 'Enter a valid US state name or two-letter abbreviation.' };
  if (!organization.enabledStates.includes(state)) return { error: 'This state is not enabled for your organization.' };
  const licenseeIds = stateScopedLicenseeIds(parseWholesaleLicenseeIds(
    String(formData.get('licenseeIds') ?? formData.get('licenseeId') ?? ''),
  ), state);
  if (!licenseeIds.length) licenseeIds.push(`MANUAL-${randomUUID()}`);
  const licenseeId = getPrimaryWholesaleLicenseeId(licenseeIds);
  const name = String(formData.get('name') ?? '').trim();

  if (!licenseeId || !name) {
    return { error: 'An account name is required.' };
  }

  const requestedTagIds = getSelectedTagIds(formData);
  const tagIds = requestedTagIds.length
    ? (await prisma.tag.findMany({ where: { id: { in: requestedTagIds }, organizationId }, select: { id: true } })).map((tag) => tag.id)
    : [];
  const matchingAccounts = await prisma.wholesaleAccount.findMany({
    where: getWholesaleLicenseeIdConflictWhere(licenseeIds),
    select: { id: true, state: true },
    take: 2,
  });
  const matchingAccountIds = Array.from(new Set(matchingAccounts.map((account) => account.id)));
  if (matchingAccounts.some((account) => (normalizeUsState(account.state) ?? 'OH') !== state)) {
    return { error: 'This Licensee ID belongs to an account in another state. Leave Licensee IDs blank to create a separate account.' };
  }

  if (matchingAccountIds.length > 1) {
    redirect('/wholesale?status=duplicate-licensee');
  }

  const officialAccount = !matchingAccountIds.length && state === 'OH' ? await prisma.account.findFirst({
    where: {
      licenseeId: { equals: licenseeId, mode: 'insensitive' },
      type: AccountType.BAR_RESTAURANT,
    },
    select: { id: true },
  }) : null;
  const accountData = {
    state,
    isActive: true,
    name,
    officialAccountId: officialAccount?.id,
    address: toOptional(String(formData.get('address') ?? '')),
    city: toOptional(String(formData.get('city') ?? '')),
    county: toOptional(String(formData.get('county') ?? '')),
    zip: toOptional(String(formData.get('zip') ?? '')),
    phone: toOptional(String(formData.get('phone') ?? '')),
    ownership: toOptional(String(formData.get('ownership') ?? '')),
    deliveryDay: toOptional(String(formData.get('deliveryDay') ?? '')),
  };
  const account = await prisma.$transaction(async (tx) => {
    const existingAccountId = matchingAccountIds[0];

    if (existingAccountId) {
      // Creating tenant activity does not authorize changes to shared identity.
      // Canonical corrections belong in the Platform Admin edit workflow.
      return { id: existingAccountId };
    }

    return tx.wholesaleAccount.create({
      data: {
        ...accountData,
        ...getWholesaleAddressProtectionForEdit(null, accountData),
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
        note: 'Applied from restaurant account form',
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
    { city: { contains: q, mode: 'insensitive' } },
    { state: { equals: normalizeUsState(q) ?? q, mode: 'insensitive' } },
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

export default async function WholesalePage({
  searchParams,
}: {
  searchParams?: Promise<WholesalePageParams>;
}) {
  const user = await requireUser();
  const { organizationId, organization } = await requireOrganizationContext(user);
  const enabledFeatures = await getOrganizationFeatures(organizationId);
  const hasWholesaleOpportunities = enabledFeatures.has('WHOLESALE_OPPORTUNITIES');
  const visibleSortColumns = hasWholesaleOpportunities
    ? wholesaleSortColumns
    : wholesaleSortColumns.filter((column) => !['commercialRating', 'nextAction'].includes(column.key));

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();
  const requestedSort = ['opportunityScore', 'opportunityPriority'].includes(params.sort ?? '') ? 'commercialRating' : params.sort;
  const sortKey = isWholesaleSortKey(requestedSort, visibleSortColumns) ? requestedSort : 'name';
  const sortDirection = getSortDirection(params.dir, sortKey);
  const accountWhere: Prisma.WholesaleAccountWhereInput = {
    isActive: true,
    ...(q ? wholesaleSearchWhere(q, organizationId, hasWholesaleOpportunities) : {}),
  };

  const [directory, tags] = await Promise.all([
    readWholesaleDirectory({ where: accountWhere, sort: sortKey, direction: sortDirection, page: params.page }),
    prisma.tag.findMany({ where: { organizationId }, orderBy: [{ name: 'asc' }] }),
  ]);
  const { accounts } = directory;
  const accountIds = accounts.map((account) => account.id);
  const targetingOverlays = await prisma.organizationAccountOverlay.findMany({ where: { organizationId, accountType: 'WHOLESALE', externalAccountId: { in: accountIds }, isTargeting: true }, select: { externalAccountId: true } });
  const targetedIds = new Set(targetingOverlays.map((item) => item.externalAccountId));
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
          hasWholesaleOpportunities ? prisma.wholesaleAccountAssessment.findMany({
            where: {
              organizationId,
              wholesaleAccountId: { in: accountIds },
            },
            orderBy: [{ rating: { sort: 'desc', nulls: 'last' } }],
            select: {
              wholesaleAccountId: true,
              rating: true,
              assessmentStatus: true,
              refreshRequestedAt: true,
              calculatedAt: true,
              action: true,
              evidenceMode: true,
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
    const locationText = [account.address, account.city, account.state, account.zip].filter(Boolean).join(', ');

    return {
      actionHref: `/visits/new?type=wholesale&wholesaleAccountId=${account.id}`,
      actionLabel: 'Log visit',
      address: account.address,
      agencyId: account.agencyId,
      city: [account.city, account.state].filter(Boolean).join(', ') || null,
      id: account.id,
      licenseeIdsText: formatWholesaleLicenseeIds(account),
      mostRecentVisit: lastVisitAt,
      name: account.name,
      nameHref: `/wholesale/${account.id}`,
      nextAction: opportunity?.action ?? null,
      commercialRating: opportunity?.rating ?? null,
      assessmentStatus: opportunity?.assessmentStatus,
      pending: Boolean(opportunity?.refreshRequestedAt),
      stale: Boolean(opportunity && Date.now() - opportunity.calculatedAt.getTime() > 48 * 3_600_000),
      evidenceMode: opportunity ? evidenceModeLabel[opportunity.evidenceMode as EvidenceMode] : undefined,
      phone: account.phone,
      directionsHref: getDirectionsHref(locationText),
      locationText: locationText || null,
    };
  });
  const sortedRows = directory.serverPaged ? activeRows : sortWholesaleRows(activeRows, sortKey, sortDirection);
  const totalRows = directory.total;
  const pagination = directoryPage(params.page, totalRows);
  const { page: currentPage, pages: totalPages } = pagination;
  const tableRows = directory.serverPaged ? sortedRows : sortedRows.slice(pagination.skip, pagination.skip + WHOLESALE_PAGE_SIZE);

  return (
    <>
      <header className="page-heading page-header">
        <div>
          <h1>Restaurants</h1>
          <p className="muted">Find an account and plan your next visit.</p>
        </div>
        <a className="btn secondary compact-btn" href="#new-restaurant">Add account</a>
      </header>
      <AccountViewNavigation active="wholesale" />
      {!q ? <NearbyAccountsSection type="wholesale" /> : null}

      <LiveFilterForm className="filter-form directory-filter" label="Filter restaurant accounts">
        <label className="sr-only" htmlFor="restaurant-search">Search restaurants</label>
        <input id="restaurant-search" name="q" type="search" defaultValue={q} placeholder="Name, licensee ID, city, or phone" />
        <input name="page" type="hidden" value="1" />
        <details className="directory-sort"><summary>Sort: {visibleSortColumns.find(column => column.key === sortKey)?.label}</summary>
        <label htmlFor="restaurant-sort">Sort by</label>
        <select id="restaurant-sort" name="sort" defaultValue={sortKey}>
          {visibleSortColumns.map((column) => (
            <option key={column.key} value={column.key}>
              {column.label}
            </option>
          ))}
        </select>
        <label htmlFor="restaurant-direction">Direction</label>
        <select id="restaurant-direction" name="dir" defaultValue={sortDirection}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
        </details>
      </LiveFilterForm>
      {params.status === 'saved' ? <p className="pill">Restaurant account saved.</p> : null}
      {params.status === 'invalid' ? <p className="pill">An account name and valid state are required.</p> : null}
      {params.status === 'duplicate-licensee' ? (
        <p className="pill">Those Licensee IDs are already split across multiple restaurant accounts.</p>
      ) : null}



      <DirectoryPagination path="/wholesale" params={params} page={currentPage} total={totalRows} />

      <div className="table-scroll wholesale-table-scroll">
        <table className="responsive-table account-directory-table restaurant-directory-table">
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
              <tr className="account-directory-row" key={row.id}>
                <td className="account-directory-name-cell" data-label="Name">
                  <Link className="table-link account-directory-name-link" href={row.nameHref ?? '/wholesale'}>
                    {row.name}
                  </Link>
                  {targetedIds.has(row.id) ? <TargetAccountMarker /> : null}
                  <span className="account-directory-mobile-only account-directory-location">
                    {row.locationText ? <AddressLink address={row.locationText} /> : (row.licenseeIdsText ? `Licensee ${row.licenseeIdsText}` : 'Location unavailable')}
                  </span>
                  {(hasWholesaleOpportunities && row.commercialRating !== null) || row.mostRecentVisit ? <span className="account-directory-mobile-only account-directory-context">
                    {hasWholesaleOpportunities && row.commercialRating !== null ? <CommercialOpportunityStars rating={row.commercialRating} status={row.assessmentStatus} pending={row.pending} stale={row.stale} /> : null}
                    {row.mostRecentVisit ? <span>Last visit {formatEasternDate(row.mostRecentVisit)}</span> : null}
                  </span> : null}
                </td>
                <td className="account-directory-secondary-cell" data-label="Licensee IDs">{row.licenseeIdsText}</td>
                <td className="account-directory-secondary-cell" data-label="Address"><AddressLink address={row.locationText}>{row.address}</AddressLink></td>
                <td className="account-directory-secondary-cell" data-label="City">{row.city}</td>
                <td className="account-directory-secondary-cell" data-label="Retail ID">{row.agencyId}</td>
                <td className="account-directory-secondary-cell" data-label="Most Recent Visit">{formatEasternDate(row.mostRecentVisit)}</td>
                {hasWholesaleOpportunities ? <><td className="account-directory-secondary-cell" data-label="Commercial opportunity"><CommercialOpportunityStars rating={row.commercialRating} status={row.assessmentStatus} pending={row.pending} stale={row.stale} />{row.evidenceMode ? <small className="muted"> {row.evidenceMode}</small> : null}</td>
                <td className="account-directory-secondary-cell" data-label="Next Action">{row.nextAction ?? '—'}</td>
                </> : null}
                <td className="account-directory-actions-cell" data-label="Actions">
                  <Link className="btn compact-btn" href={row.actionHref ?? '/wholesale'}>
                    {row.actionLabel}
                  </Link>
                  {row.phone ? <a aria-label={`Call ${row.name}`} className="btn secondary compact-btn account-directory-mobile-only" href={`tel:${row.phone}`}>Call</a> : null}
                  {row.directionsHref ? <a aria-label={`Directions to ${row.name}`} className="btn secondary compact-btn account-directory-mobile-only" href={row.directionsHref} rel="noreferrer" target="_blank">Directions</a> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? <DirectoryPagination path="/wholesale" params={params} page={currentPage} total={totalRows} /> : null}
      {q && sortedRows.length === 0 ? (
        <p className="muted activity-empty">No active or official restaurant accounts match that search.</p>
      ) : null}
      <AnchoredDetails className="card compact-details admin-panel" id="new-restaurant" summary="Add restaurant account">
        <ActionForm action={createWholesale} className="wholesale-create-form">
          <fieldset className="wholesale-create-section">
            <legend>Account</legend>
            <div className="wholesale-create-grid">
              <label>Account name<input name="name" required autoComplete="organization" /></label>
              <label>Phone (optional)<input name="phone" type="tel" autoComplete="tel" /></label>
            </div>
          </fieldset>
          <WholesaleAddressFields allowedStates={organization.enabledStates} />
          <fieldset className="wholesale-create-section">
            <legend>Additional details (optional)</legend>
            <div className="wholesale-create-grid wholesale-create-extras">
              <label>Licensee IDs<input name="licenseeIds" placeholder="Separate multiple IDs with commas" /></label>
              <label>Ownership<input name="ownership" /></label>
              <label>Delivery day<input name="deliveryDay" /></label>
            </div>
          </fieldset>
          {tags.length > 0 ? (
            <fieldset className="wholesale-create-section">
              <legend>Tags (optional)</legend>
              <div className="tag-checkbox-grid">
                {tags.map((tag) => (
                  <label className="tag-checkbox" key={tag.id}>
                    <input name="tagId" type="checkbox" value={tag.id} />
                    <span className="tag-swatch" style={{ backgroundColor: tag.color ?? '#7c9cff' }} />
                    <span>{tag.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <SubmitButton type="submit">Save restaurant account</SubmitButton>
        </ActionForm>
      </AnchoredDetails>
    </>
  );
}
