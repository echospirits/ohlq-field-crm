export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MenuPlacementStatus, MenuPlacementType, Prisma } from '@prisma/client';
import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { getWholesaleRecentPurchases } from '../../../lib/ohlqSalesData';
import { prisma } from '../../../lib/prisma';
import { MenuPlacementPanel } from '../../menu-placements/MenuPlacementPanel';
import { addRecipeSuggestion, removeRecipeSuggestion } from '../../recipes/actions';
import { AccountTagPanel } from '../../tags/AccountTagPanel';
import { TagBadges } from '../../tags/TagBadges';
import { VisitActivityTable } from '../../visits/VisitActivityTable';
import { WholesaleRecentPurchasesCard } from '../WholesaleRecentPurchasesCard';

const formatDate = (date: Date | null | undefined) => (date ? new Date(date).toLocaleDateString() : 'No visits yet');
const todayInputValue = () => new Date().toISOString().slice(0, 10);
const tagStatusMessages: Record<string, string> = {
  added: 'Tag added.',
  removed: 'Tag removed.',
  invalid: 'Select a valid tag.',
};
const statusMessages: Record<string, string> = {
  updated: 'Wholesale account updated.',
  activated: 'Account activated.',
};
const suggestionStatusMessages: Record<string, string> = {
  added: 'Recipe suggestion saved.',
  removed: 'Recipe suggestion removed.',
  invalid: 'Select a valid recipe and wholesale account.',
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
    suggestionStatus?: string;
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
    },
  });

  if (!account) {
    notFound();
  }

  const [visits, tags, recipeSuggestions, backingAccount, users, purchases] = await Promise.all([
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
    prisma.recipeSuggestion.findMany({
      where: { wholesaleAccountId: id },
      include: {
        recipe: true,
        createdByUser: true,
      },
      orderBy: [{ suggestedAt: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.account.findUnique({
      where: { licenseeId: account.licenseeId },
      select: { id: true },
    }),
    prisma.user.findMany({ orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
    getWholesaleRecentPurchases({ licenseeId: account.licenseeId }),
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
  const suggestedRecipeIds = recipeSuggestions.map((suggestion) => suggestion.recipeId);
  const recipes = await prisma.recipe.findMany({
    where: suggestedRecipeIds.length > 0 ? { id: { notIn: suggestedRecipeIds } } : undefined,
    orderBy: [{ name: 'asc' }],
    take: 500,
    select: {
      id: true,
      name: true,
      primarySpirit: true,
      complexity: true,
    },
  });

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
        <Link className="btn compact-btn secondary" href={`/wholesale/${account.id}/edit`}>
          Edit
        </Link>
      </div>

      <h1>{account.name}</h1>
      <p className="muted">Licensee {account.licenseeId}</p>
      {!account.isActive ? <p className="pill">Inactive</p> : null}
      {query.status ? <p className="pill">{statusMessages[query.status] ?? query.status}</p> : null}
      {query.tagStatus ? <p className="pill">{tagStatusMessages[query.tagStatus] ?? query.tagStatus}</p> : null}
      {query.suggestionStatus ? (
        <p className="pill">{suggestionStatusMessages[query.suggestionStatus] ?? query.suggestionStatus}</p>
      ) : null}
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
          <h2>Recipe Suggestions</h2>
          <span className="pill">{recipeSuggestions.length}</span>
        </div>

        <div className="card admin-panel">
          <form action={addRecipeSuggestion} className="inline-suggestion-form">
            <input name="wholesaleAccountId" type="hidden" value={account.id} />
            <input name="returnTo" type="hidden" value={`/wholesale/${account.id}`} />
            <label>
              Recipe
              <select disabled={recipes.length === 0} name="recipeId" required>
                <option value="">-- Select recipe --</option>
                {recipes.map((recipeOption) => (
                  <option key={recipeOption.id} value={recipeOption.id}>
                    {recipeOption.name}
                    {recipeOption.primarySpirit ? ` / ${recipeOption.primarySpirit}` : ''}
                    {recipeOption.complexity ? ` / ${recipeOption.complexity}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date suggested
              <input name="suggestedAt" type="date" defaultValue={todayInputValue()} />
            </label>
            <label>
              Note
              <input name="note" placeholder="Optional note" />
            </label>
            <button disabled={recipes.length === 0} type="submit">
              Save suggestion
            </button>
          </form>
        </div>

        <table className="responsive-table">
          <thead>
            <tr>
              <th>Recipe</th>
              <th>Primary Spirit</th>
              <th>Date Suggested</th>
              <th>Note</th>
              <th>Added By</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {recipeSuggestions.map((suggestion) => (
              <tr key={suggestion.id}>
                <td data-label="Recipe">
                  <Link className="table-link" href={`/recipes/${suggestion.recipe.id}`}>
                    {suggestion.recipe.name}
                  </Link>
                </td>
                <td data-label="Primary Spirit">{suggestion.recipe.primarySpirit}</td>
                <td data-label="Date Suggested">{formatDate(suggestion.suggestedAt)}</td>
                <td data-label="Note">{suggestion.note}</td>
                <td data-label="Added By">
                  {suggestion.createdByUser ? getUserDisplayName(suggestion.createdByUser) : 'Unknown user'}
                </td>
                <td data-label="Action">
                  <form action={removeRecipeSuggestion}>
                    <input name="id" type="hidden" value={suggestion.id} />
                    <input name="recipeId" type="hidden" value={suggestion.recipe.id} />
                    <input name="wholesaleAccountId" type="hidden" value={account.id} />
                    <input name="returnTo" type="hidden" value={`/wholesale/${account.id}`} />
                    <button className="secondary compact-btn" type="submit">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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
