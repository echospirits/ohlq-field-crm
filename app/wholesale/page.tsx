export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountType, Prisma } from '@prisma/client';
import { requireUser } from '../../lib/auth';
import { formatEasternDate } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';
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
import { TagBadges } from '../tags/TagBadges';
import { activateOfficialWholesaleAccount } from './actions';

const toOptional = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

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
  const licenseeIds = parseWholesaleLicenseeIds(
    String(formData.get('licenseeIds') ?? formData.get('licenseeId') ?? ''),
  );
  const licenseeId = getPrimaryWholesaleLicenseeId(licenseeIds);
  const name = String(formData.get('name') ?? '').trim();

  if (!licenseeId || !name) {
    redirect('/wholesale?status=invalid');
  }

  const tagIds = getSelectedTagIds(formData);
  const matchingAccounts = await prisma.wholesaleAccount.findMany({
    where: getWholesaleLicenseeIdConflictWhere(licenseeIds),
    select: { id: true },
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
      const updatedAccount = await tx.wholesaleAccount.update({
        where: { id: existingAccountId },
        data: {
          ...accountData,
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

const wholesaleSearchWhere = (q: string): Prisma.WholesaleAccountWhereInput => ({
  OR: [
    { name: { contains: q, mode: 'insensitive' } },
    ...getWholesaleLicenseeIdTextSearchWhere(q),
    { agencyId: { contains: q, mode: 'insensitive' } },
    { address: { contains: q, mode: 'insensitive' } },
    { phone: { contains: q, mode: 'insensitive' } },
    { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } },
    { recipeSuggestions: { some: { recipe: { name: { contains: q, mode: 'insensitive' } } } } },
    { recipeSuggestions: { some: { recipe: { primarySpirit: { contains: q, mode: 'insensitive' } } } } },
    { menuPlacements: { some: { product: { contains: q, mode: 'insensitive' } } } },
    { menuPlacements: { some: { menuItemName: { contains: q, mode: 'insensitive' } } } },
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
  searchParams?: Promise<{ q?: string; status?: string }>;
}) {
  await requireUser();

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();
  const accountWhere: Prisma.WholesaleAccountWhereInput = {
    isActive: true,
    ...(q ? wholesaleSearchWhere(q) : {}),
  };

  const [accounts, tags, officialCandidates] = await Promise.all([
    prisma.wholesaleAccount.findMany({
      take: 300,
      where: accountWhere,
      include: {
        licenseeIds: {
          orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }],
          select: { licenseeId: true },
        },
        tags: {
          include: { tag: true },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { menuPlacements: true, recipeSuggestions: true },
        },
      },
      orderBy: [{ name: 'asc' }, { licenseeId: 'asc' }],
    }),
    prisma.tag.findMany({ orderBy: [{ name: 'asc' }] }),
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
            phone: true,
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
  const visitStats =
    accountIds.length > 0
      ? await prisma.loggedVisit.groupBy({
          by: ['wholesaleAccountId'],
          where: {
            locationType: 'wholesale',
            wholesaleAccountId: { in: accountIds },
          },
          _count: { _all: true },
          _max: { visitAt: true },
        })
      : [];
  const visitStatMap = Object.fromEntries(
    visitStats.map((stat) => [
      stat.wholesaleAccountId ?? '',
      {
        count: stat._count._all,
        lastVisitAt: stat._max.visitAt,
      },
    ]),
  );

  return (
    <>
      <h1>Wholesale Accounts</h1>
      <p className="muted">Active accounts by default. Search also checks inactive official OHLQ records.</p>

      <LiveFilterForm className="filter-form narrow-filter" label="Filter wholesale accounts">
        <input name="q" defaultValue={q} placeholder="Filter name, licensee ID, recipe, menu placement, phone" />
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

      <table className="responsive-table">
        <thead>
          <tr>
            <th>Actions</th>
            <th>Status</th>
            <th>Licensee IDs</th>
            <th>Name</th>
            <th>Agency ID</th>
            <th>Address</th>
            <th>City</th>
            <th>Phone</th>
            <th>Tags</th>
            <th>Menu Placements</th>
            <th>Recipe Suggestions</th>
            <th>Logged Visits</th>
            <th>Most Recent Visit</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const stats = visitStatMap[account.id] ?? { count: 0, lastVisitAt: null };

            return (
              <tr key={account.id}>
                <td data-label="Actions">
                  <Link className="btn compact-btn" href={`/visits/new?type=wholesale&wholesaleAccountId=${account.id}`}>
                    Log visit
                  </Link>
                </td>
                <td data-label="Status">
                  <span className="pill">Active</span>
                </td>
                <td data-label="Licensee IDs">{formatWholesaleLicenseeIds(account)}</td>
                <td data-label="Name">
                  <Link className="table-link" href={`/wholesale/${account.id}`}>
                    {account.name}
                  </Link>
                </td>
                <td data-label="Agency ID">{account.agencyId}</td>
                <td data-label="Address">{account.address}</td>
                <td data-label="City">{account.city}</td>
                <td data-label="Phone">{account.phone}</td>
                <td data-label="Tags">
                  <TagBadges tags={account.tags.map((assignment) => assignment.tag)} />
                </td>
                <td data-label="Menu Placements">{account._count.menuPlacements}</td>
                <td data-label="Recipe Suggestions">{account._count.recipeSuggestions}</td>
                <td data-label="Logged Visits">{stats.count}</td>
                <td data-label="Most Recent Visit">{formatEasternDate(stats.lastVisitAt)}</td>
              </tr>
            );
          })}
          {officialAccounts.map((account) => (
            <tr className="inactive-official-row" key={account.id}>
              <td data-label="Actions">
                <form action={activateOfficialWholesaleAccount}>
                  <input name="officialAccountId" type="hidden" value={account.id} />
                  <button className="compact-btn secondary" type="submit">
                    Activate
                  </button>
                </form>
              </td>
              <td data-label="Status">
                <span className="pill">Official record - inactive</span>
                <span className="muted tap-to-activate">Tap to activate</span>
              </td>
              <td data-label="Licensee ID">{account.licenseeId}</td>
              <td data-label="Name">
                <form action={activateOfficialWholesaleAccount} className="inline-activate-form">
                  <input name="officialAccountId" type="hidden" value={account.id} />
                  <button className="link-button table-link" type="submit">
                    {account.name}
                  </button>
                </form>
              </td>
              <td data-label="Agency ID">{account.agencyRefId}</td>
              <td data-label="Address">{account.address}</td>
              <td data-label="City">{account.city}</td>
              <td data-label="Phone">{account.phone}</td>
              <td data-label="Tags">
                <span className="muted">Activate to tag</span>
              </td>
              <td data-label="Menu Placements">0</td>
              <td data-label="Recipe Suggestions">0</td>
              <td data-label="Logged Visits">0</td>
              <td data-label="Most Recent Visit">{formatEasternDate(null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {q && accounts.length === 0 && officialAccounts.length === 0 ? (
        <p className="muted activity-empty">No active or official wholesale accounts match that search.</p>
      ) : null}
    </>
  );
}
