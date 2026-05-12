export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { createRecipe } from '../actions';
import { RecipeForm } from '../RecipeForm';

const statusMessages: Record<string, string> = {
  invalid: 'Recipe name and recipe text are required.',
  'invalid-photo': 'Photos must be image files.',
  'photo-too-large': 'Each uploaded photo must be 5 MB or smaller.',
  'storage-not-configured': 'Photo object storage is not configured yet.',
};

export default async function NewRecipePage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireUser();
  const query = (await searchParams) ?? {};

  return (
    <>
      <div className="page-actions">
        <Link href="/recipes">Back to recipes</Link>
      </div>

      <h1>New Recipe</h1>
      {query.status ? <p className="pill">{statusMessages[query.status] ?? query.status}</p> : null}

      <div className="card admin-panel">
        <RecipeForm action={createRecipe} submitLabel="Save recipe" />
      </div>
    </>
  );
}
