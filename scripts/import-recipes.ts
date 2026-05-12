import { createHash } from 'crypto';
import { UserRole } from '@prisma/client';
import Papa from 'papaparse';
import { prisma } from '../lib/prisma';

const DEFAULT_RECIPE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1bcs325mQPmwKfOgo8K_75ZsfzGyw5ay-Pt6ww03TQTA/gviz/tq?tqx=out:csv';
const importSource = 'google-sheet-recipes-2026-05-12';

type RecipeSheetRow = Record<string, string | undefined>;

const clean = (value: unknown) => String(value ?? '').trim();

const toIngredientJson = (recipeText: string) =>
  recipeText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text }));

const getImportKey = (row: RecipeSheetRow) => {
  const values = [
    clean(row['Primary Spirit']),
    clean(row['Stir or Shake']),
    clean(row['Good Glassware']),
    clean(row['Recipe']),
    clean(row['Originally Served at (not required)']),
    clean(row['Fits what need']),
    clean(row['Complexity']),
    clean(row["Name or Description (Don't re-use the name!)"]),
  ];

  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
};

async function getImportUserId() {
  const requestedEmail = process.env.RECIPE_IMPORT_USER_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? 'joe@echospirits.com';
  const requestedUser = await prisma.user.findUnique({
    where: { email: requestedEmail },
    select: { id: true },
  });

  if (requestedUser) {
    return requestedUser.id;
  }

  const fallbackUser = await prisma.user.findFirst({
    where: { role: UserRole.ADMIN },
    select: { id: true },
  });

  if (fallbackUser) {
    return fallbackUser.id;
  }

  const anyUser = await prisma.user.findFirst({ select: { id: true } });
  return anyUser?.id ?? null;
}

async function getSheetRows() {
  const url = process.env.RECIPE_IMPORT_URL ?? DEFAULT_RECIPE_SHEET_URL;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download recipe sheet: ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();
  const parsed = Papa.parse(csv.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(`Failed to parse recipe sheet: ${parsed.errors[0]?.message ?? 'Unknown parse error'}`);
  }

  return parsed.data as RecipeSheetRow[];
}

async function main() {
  const rows = await getSheetRows();
  const importUserId = await getImportUserId();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const [index, row] of rows.entries()) {
    const recipeText = clean(row.Recipe);
    const name = clean(row["Name or Description (Don't re-use the name!)"]) || `Imported recipe ${index + 1}`;

    if (!recipeText || !name) {
      skipped += 1;
      continue;
    }

    const importKey = getImportKey(row);
    const existingRecipe = await prisma.recipe.findUnique({
      where: { importKey },
      select: { id: true },
    });
    const recipeData = {
      name,
      primarySpirit: clean(row['Primary Spirit']) || null,
      preparation: clean(row['Stir or Shake']) || null,
      glassware: clean(row['Good Glassware']) || null,
      sourceAttribution: clean(row['Originally Served at (not required)']) || null,
      fitsNeed: clean(row['Fits what need']) || null,
      complexity: clean(row.Complexity) || null,
      recipeText,
      ingredients: toIngredientJson(recipeText),
      instructions: '',
      importSource,
      updatedByUserId: importUserId,
    };

    if (existingRecipe) {
      await prisma.recipe.update({
        where: { id: existingRecipe.id },
        data: recipeData,
      });
      updated += 1;
    } else {
      await prisma.recipe.create({
        data: {
          ...recipeData,
          importKey,
          createdByUserId: importUserId,
        },
      });
      created += 1;
    }
  }

  console.log(`Recipe import complete. Created: ${created}. Updated: ${updated}. Skipped: ${skipped}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
