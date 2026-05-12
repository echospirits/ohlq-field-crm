export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { deleteRecipe, updateRecipe } from '../../actions';
import { RecipeForm } from '../../RecipeForm';

const statusMessages: Record<string, string> = {
  invalid: 'Recipe name and recipe text are required.',
  'invalid-photo': 'Photos must be image files.',
  'photo-too-large': 'Each uploaded photo must be 5 MB or smaller.',
  'storage-not-configured': 'Photo object storage is not configured yet.',
  'photo-upload-failed': 'The recipe was saved, but the photo could not be uploaded.',
};

export default async function EditRecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const recipe = await prisma.recipe.findUnique({
    where: { id },
  });

  if (!recipe) {
    notFound();
  }

  return (
    <>
      <div className="page-actions">
        <Link href={`/recipes/${recipe.id}`}>Back to recipe</Link>
      </div>

      <h1>Edit Recipe</h1>
      <p className="muted">{recipe.name}</p>
      {query.status ? <p className="pill">{statusMessages[query.status] ?? query.status}</p> : null}

      <div className="card admin-panel">
        <RecipeForm action={updateRecipe} recipe={recipe} submitLabel="Save changes" />
      </div>

      <details className="card compact-details admin-panel danger-zone">
        <summary>Delete recipe</summary>
        <form action={deleteRecipe}>
          <input name="id" type="hidden" value={recipe.id} />
          <button className="danger-btn" type="submit">
            Delete recipe
          </button>
        </form>
      </details>
    </>
  );
}
