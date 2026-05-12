export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import type { Prisma } from '@prisma/client';
import Link from 'next/link';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { LiveFilterForm } from '../components/LiveFilterForm';

const formatDate = (date: Date | null | undefined) => (date ? new Date(date).toLocaleDateString() : '');

const statusMessages: Record<string, string> = {
  deleted: 'Recipe deleted.',
  invalid: 'Select a valid recipe.',
};

export default async function RecipesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; primarySpirit?: string; complexity?: string; status?: string }>;
}) {
  await requireUser();
  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();
  const primarySpirit = (params.primarySpirit ?? '').trim();
  const complexity = (params.complexity ?? '').trim();
  const filters: Prisma.RecipeWhereInput[] = [];

  if (q) {
    filters.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { primarySpirit: { contains: q, mode: 'insensitive' } },
        { preparation: { contains: q, mode: 'insensitive' } },
        { glassware: { contains: q, mode: 'insensitive' } },
        { fitsNeed: { contains: q, mode: 'insensitive' } },
        { complexity: { contains: q, mode: 'insensitive' } },
        { recipeText: { contains: q, mode: 'insensitive' } },
        { instructions: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        { suggestions: { some: { wholesaleAccount: { name: { contains: q, mode: 'insensitive' } } } } },
      ],
    });
  }

  if (primarySpirit) {
    filters.push({ primarySpirit });
  }

  if (complexity) {
    filters.push({ complexity });
  }

  const where = filters.length > 0 ? { AND: filters } : undefined;

  const [recipes, spiritOptions, complexityOptions] = await Promise.all([
    prisma.recipe.findMany({
      where,
      take: 300,
      include: {
        createdByUser: true,
        _count: {
          select: { suggestions: true },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    }),
    prisma.recipe.findMany({
      distinct: ['primarySpirit'],
      where: { primarySpirit: { not: null } },
      select: { primarySpirit: true },
      orderBy: { primarySpirit: 'asc' },
    }),
    prisma.recipe.findMany({
      distinct: ['complexity'],
      where: { complexity: { not: null } },
      select: { complexity: true },
      orderBy: { complexity: 'asc' },
    }),
  ]);

  return (
    <>
      <div className="page-actions">
        <Link className="btn compact-btn" href="/recipes/new">
          New Recipe
        </Link>
      </div>

      <h1>Recipe Database</h1>
      {params.status ? <p className="pill">{statusMessages[params.status] ?? params.status}</p> : null}

      <LiveFilterForm className="filter-form recipe-filter" label="Filter recipes">
        <input name="q" defaultValue={q} placeholder="Search name, spirit, need, glassware, account" type="search" />
        <select name="primarySpirit" defaultValue={primarySpirit} aria-label="Primary spirit">
          <option value="">All spirits</option>
          {spiritOptions.map((option) => (
            <option key={option.primarySpirit ?? ''} value={option.primarySpirit ?? ''}>
              {option.primarySpirit}
            </option>
          ))}
        </select>
        <select name="complexity" defaultValue={complexity} aria-label="Complexity">
          <option value="">All complexity</option>
          {complexityOptions.map((option) => (
            <option key={option.complexity ?? ''} value={option.complexity ?? ''}>
              {option.complexity}
            </option>
          ))}
        </select>
      </LiveFilterForm>

      <div className="recipe-grid">
        {recipes.map((recipe) => (
          <article className="card recipe-card" key={recipe.id}>
            <Link className="recipe-card-media" href={`/recipes/${recipe.id}`}>
              {recipe.photoUrl ? (
                <img alt={recipe.photoCaption || recipe.name} src={recipe.photoUrl} />
              ) : (
                <span>{recipe.primarySpirit ?? 'Recipe'}</span>
              )}
            </Link>
            <div className="recipe-card-body">
              <div>
                <Link className="table-link" href={`/recipes/${recipe.id}`}>
                  {recipe.name}
                </Link>
                <p className="muted inline-meta">
                  {[recipe.primarySpirit, recipe.preparation, recipe.glassware].filter(Boolean).join(' / ')}
                </p>
              </div>
              <p className="recipe-card-text preserve-lines">{recipe.recipeText}</p>
              <div className="inline-meta">
                {recipe.fitsNeed ? <span className="pill">{recipe.fitsNeed}</span> : null}
                {recipe.complexity ? <span className="pill">{recipe.complexity}</span> : null}
                <span className="pill">{recipe._count.suggestions} suggested</span>
              </div>
              <p className="muted item-meta">Updated {formatDate(recipe.updatedAt)}</p>
            </div>
          </article>
        ))}
      </div>

      {recipes.length === 0 ? <p className="muted">No recipes match the current filters.</p> : null}
    </>
  );
}
