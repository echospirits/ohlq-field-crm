export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { addRecipeSuggestion, removeRecipeSuggestion } from '../actions';

const formatDate = (date: Date | null | undefined) => (date ? new Date(date).toLocaleDateString() : '');
const todayInputValue = () => new Date().toISOString().slice(0, 10);

const statusMessages: Record<string, string> = {
  created: 'Recipe saved.',
  updated: 'Recipe updated.',
};

const suggestionStatusMessages: Record<string, string> = {
  added: 'Recipe suggestion saved.',
  removed: 'Recipe suggestion removed.',
  invalid: 'Select a valid recipe and wholesale account.',
};

export default async function RecipeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string; suggestionStatus?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: {
      createdByUser: true,
      updatedByUser: true,
      suggestions: {
        include: {
          createdByUser: true,
          wholesaleAccount: true,
        },
        orderBy: [{ suggestedAt: 'desc' }, { createdAt: 'desc' }],
      },
    },
  });

  if (!recipe) {
    notFound();
  }

  const suggestedAccountIds = recipe.suggestions.map((suggestion) => suggestion.wholesaleAccountId);
  const availableWholesaleAccounts = await prisma.wholesaleAccount.findMany({
    where: {
      isActive: true,
      ...(suggestedAccountIds.length > 0 ? { id: { notIn: suggestedAccountIds } } : {}),
    },
    orderBy: [{ name: 'asc' }, { licenseeId: 'asc' }],
    take: 500,
    select: {
      id: true,
      licenseeId: true,
      name: true,
      city: true,
    },
  });

  return (
    <>
      <div className="page-actions">
        <Link href="/recipes">Back to recipes</Link>
        <Link className="btn compact-btn secondary" href={`/recipes/${recipe.id}/edit`}>
          Edit
        </Link>
      </div>

      <h1>{recipe.name}</h1>
      {query.status ? <p className="pill">{statusMessages[query.status] ?? query.status}</p> : null}
      {query.suggestionStatus ? (
        <p className="pill">{suggestionStatusMessages[query.suggestionStatus] ?? query.suggestionStatus}</p>
      ) : null}

      <div className="recipe-detail-layout">
        <section className="card recipe-detail-main">
          {recipe.photoUrl ? (
            <img className="recipe-hero-photo" alt={recipe.photoCaption || recipe.name} src={recipe.photoUrl} />
          ) : null}

          <div className="inline-meta">
            {recipe.primarySpirit ? <span className="pill">{recipe.primarySpirit}</span> : null}
            {recipe.preparation ? <span className="pill">{recipe.preparation}</span> : null}
            {recipe.glassware ? <span className="pill">{recipe.glassware}</span> : null}
            {recipe.complexity ? <span className="pill">{recipe.complexity}</span> : null}
          </div>

          <h2>Recipe</h2>
          <p className="preserve-lines recipe-body-text">{recipe.recipeText}</p>

          {recipe.instructions ? (
            <>
              <h2>Instructions</h2>
              <p className="preserve-lines recipe-body-text">{recipe.instructions}</p>
            </>
          ) : null}

          {recipe.notes ? (
            <>
              <h2>Notes</h2>
              <p className="preserve-lines recipe-body-text">{recipe.notes}</p>
            </>
          ) : null}
        </section>

        <section className="card recipe-side-panel">
          <h3>Details</h3>
          <dl className="detail-list">
            <div>
              <dt>Need</dt>
              <dd>{recipe.fitsNeed}</dd>
            </div>
            <div>
              <dt>Season</dt>
              <dd>{recipe.season}</dd>
            </div>
            <div>
              <dt>Flavor</dt>
              <dd>{recipe.flavorProfile}</dd>
            </div>
            <div>
              <dt>Garnish</dt>
              <dd>{recipe.garnish}</dd>
            </div>
            <div>
              <dt>Originally served at</dt>
              <dd>{recipe.sourceAttribution}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                {formatDate(recipe.createdAt)}
                {recipe.createdByUser ? ` by ${getUserDisplayName(recipe.createdByUser)}` : ''}
              </dd>
            </div>
            <div>
              <dt>Edited</dt>
              <dd>
                {formatDate(recipe.updatedAt)}
                {recipe.updatedByUser ? ` by ${getUserDisplayName(recipe.updatedByUser)}` : ''}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Suggested Wholesale Accounts</h2>
          <span className="pill">{recipe.suggestions.length}</span>
        </div>

        <div className="card admin-panel">
          <form action={addRecipeSuggestion} className="inline-suggestion-form">
            <input name="recipeId" type="hidden" value={recipe.id} />
            <input name="returnTo" type="hidden" value={`/recipes/${recipe.id}`} />
            <label>
              Account
              <select disabled={availableWholesaleAccounts.length === 0} name="wholesaleAccountId" required>
                <option value="">-- Select wholesale account --</option>
                {availableWholesaleAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} / {account.licenseeId}
                    {account.city ? ` / ${account.city}` : ''}
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
            <button disabled={availableWholesaleAccounts.length === 0} type="submit">
              Save suggestion
            </button>
          </form>
        </div>

        <table className="responsive-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Licensee ID</th>
              <th>Date Suggested</th>
              <th>Note</th>
              <th>Added By</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {recipe.suggestions.map((suggestion) => (
              <tr key={suggestion.id}>
                <td data-label="Account">
                  <Link className="table-link" href={`/wholesale/${suggestion.wholesaleAccount.id}`}>
                    {suggestion.wholesaleAccount.name}
                  </Link>
                </td>
                <td data-label="Licensee ID">{suggestion.wholesaleAccount.licenseeId}</td>
                <td data-label="Date Suggested">{formatDate(suggestion.suggestedAt)}</td>
                <td data-label="Note">{suggestion.note}</td>
                <td data-label="Added By">
                  {suggestion.createdByUser ? getUserDisplayName(suggestion.createdByUser) : 'Unknown user'}
                </td>
                <td data-label="Action">
                  <form action={removeRecipeSuggestion}>
                    <input name="id" type="hidden" value={suggestion.id} />
                    <input name="recipeId" type="hidden" value={recipe.id} />
                    <input name="wholesaleAccountId" type="hidden" value={suggestion.wholesaleAccount.id} />
                    <input name="returnTo" type="hidden" value={`/recipes/${recipe.id}`} />
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
    </>
  );
}
