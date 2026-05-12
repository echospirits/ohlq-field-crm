'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import {
  deleteStoredPhoto,
  uploadRecipePhoto,
  validateRecipePhotoFile,
} from '../../lib/blob';
import { prisma } from '../../lib/prisma';

type PhotoInput =
  | { type: 'none' }
  | { type: 'remove' }
  | { type: 'url'; url: string }
  | { type: 'file'; file: File };

type RecipePhotoUpdate = {
  photoCaption?: string | null;
  photoUrl?: string | null;
  photoStorageKey?: string | null;
  photoContentType?: string | null;
  photoSizeBytes?: number | null;
};

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeText = (value: FormDataEntryValue | null | undefined) =>
  String(value ?? '').trim().replace(/\r\n/g, '\n');

const toIngredientJson = (recipeText: string) =>
  recipeText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text }));

const toDate = (value: FormDataEntryValue | null | undefined) => {
  const date = toOptional(value);
  return date ? new Date(`${date}T12:00:00`) : null;
};

const safeReturnTo = (value: FormDataEntryValue | null | undefined, fallback = '/recipes') => {
  const path = toOptional(value);
  return path && path.startsWith('/') && !path.startsWith('//') ? path : fallback;
};

const redirectWithStatus = (path: string, key: 'status' | 'suggestionStatus', status: string): never => {
  const separator = path.includes('?') ? '&' : '?';
  redirect(`${path}${separator}${key}=${status}`);
};

function getPhotoInput(formData: FormData, invalidRedirectPath: string): PhotoInput {
  const removePhoto = String(formData.get('removePhoto') ?? '') === 'on';
  const photoUrl = toOptional(formData.get('photoUrl'));
  const photoFile = formData.get('photoFile');

  if (photoFile instanceof File && photoFile.size > 0) {
    const validationError = validateRecipePhotoFile(photoFile);

    if (validationError) {
      redirectWithStatus(invalidRedirectPath, 'status', validationError);
    }

    return { type: 'file', file: photoFile };
  }

  if (photoUrl) {
    return { type: 'url', url: photoUrl };
  }

  if (removePhoto) {
    return { type: 'remove' };
  }

  return { type: 'none' };
}

function getRecipeInput(formData: FormData) {
  const name = normalizeText(formData.get('name')).replace(/\s+/g, ' ');
  const recipeText = normalizeText(formData.get('recipeText'));

  return {
    name,
    recipeText,
    primarySpirit: toOptional(formData.get('primarySpirit')),
    preparation: toOptional(formData.get('preparation')),
    glassware: toOptional(formData.get('glassware')),
    sourceAttribution: toOptional(formData.get('sourceAttribution')),
    fitsNeed: toOptional(formData.get('fitsNeed')),
    complexity: toOptional(formData.get('complexity')),
    instructions: normalizeText(formData.get('instructions')),
    garnish: toOptional(formData.get('garnish')),
    season: toOptional(formData.get('season')),
    flavorProfile: toOptional(formData.get('flavorProfile')),
    notes: normalizeText(formData.get('notes')) || null,
    photoCaption: toOptional(formData.get('photoCaption')),
  };
}

export async function createRecipe(formData: FormData) {
  const user = await requireUser();
  const input = getRecipeInput(formData);

  if (!input.name || !input.recipeText) {
    redirect('/recipes/new?status=invalid');
  }

  const photoInput = getPhotoInput(formData, '/recipes/new');
  const recipe = await prisma.recipe.create({
    data: {
      ...input,
      ingredients: toIngredientJson(input.recipeText),
      createdByUserId: user.id,
      updatedByUserId: user.id,
    },
  });

  if (photoInput.type === 'file') {
    try {
      const uploadedPhoto = await uploadRecipePhoto(photoInput.file, recipe.id, user.id);
      await prisma.recipe.update({
        where: { id: recipe.id },
        data: {
          photoUrl: uploadedPhoto.url,
          photoStorageKey: uploadedPhoto.storageKey,
          photoContentType: uploadedPhoto.contentType,
          photoSizeBytes: uploadedPhoto.sizeBytes,
        },
      });
    } catch {
      redirect(`/recipes/${recipe.id}/edit?status=photo-upload-failed`);
    }
  }

  if (photoInput.type === 'url') {
    await prisma.recipe.update({
      where: { id: recipe.id },
      data: {
        photoUrl: photoInput.url,
        photoStorageKey: null,
        photoContentType: null,
        photoSizeBytes: null,
      },
    });
  }

  revalidatePath('/recipes');
  redirect(`/recipes/${recipe.id}?status=created`);
}

export async function updateRecipe(formData: FormData) {
  const user = await requireUser();
  const id = toOptional(formData.get('id'));

  if (!id) {
    redirect('/recipes?status=invalid');
  }

  const currentRecipe = await prisma.recipe.findUnique({
    where: { id },
    select: {
      id: true,
      photoStorageKey: true,
    },
  });

  if (!currentRecipe) {
    notFound();
  }

  const input = getRecipeInput(formData);

  if (!input.name || !input.recipeText) {
    redirect(`/recipes/${id}/edit?status=invalid`);
  }

  const photoInput = getPhotoInput(formData, `/recipes/${id}/edit`);
  const photoUpdate: RecipePhotoUpdate = {
    photoCaption: input.photoCaption,
  };
  let shouldDeleteStoredPhoto = false;

  if (photoInput.type === 'file') {
    try {
      const uploadedPhoto = await uploadRecipePhoto(photoInput.file, id, user.id);
      Object.assign(photoUpdate, {
        photoUrl: uploadedPhoto.url,
        photoStorageKey: uploadedPhoto.storageKey,
        photoContentType: uploadedPhoto.contentType,
        photoSizeBytes: uploadedPhoto.sizeBytes,
      });
      shouldDeleteStoredPhoto = !!currentRecipe.photoStorageKey;
    } catch {
      redirect(`/recipes/${id}/edit?status=photo-upload-failed`);
    }
  }

  if (photoInput.type === 'url') {
    Object.assign(photoUpdate, {
      photoUrl: photoInput.url,
      photoStorageKey: null,
      photoContentType: null,
      photoSizeBytes: null,
    });
    shouldDeleteStoredPhoto = !!currentRecipe.photoStorageKey;
  }

  if (photoInput.type === 'remove') {
    Object.assign(photoUpdate, {
      photoUrl: null,
      photoStorageKey: null,
      photoContentType: null,
      photoSizeBytes: null,
      photoCaption: null,
    });
    shouldDeleteStoredPhoto = !!currentRecipe.photoStorageKey;
  }

  await prisma.recipe.update({
    where: { id },
    data: {
      ...input,
      ...photoUpdate,
      ingredients: toIngredientJson(input.recipeText),
      updatedByUserId: user.id,
    },
  });

  if (shouldDeleteStoredPhoto) {
    await deleteStoredPhoto(currentRecipe.photoStorageKey).catch(() => undefined);
  }

  revalidatePath('/recipes');
  revalidatePath(`/recipes/${id}`);
  redirect(`/recipes/${id}?status=updated`);
}

export async function deleteRecipe(formData: FormData) {
  await requireUser();
  const id = toOptional(formData.get('id'));

  if (!id) {
    redirect('/recipes?status=invalid');
  }

  const recipe = await prisma.recipe.findUnique({
    where: { id },
    select: { photoStorageKey: true },
  });

  if (!recipe) {
    notFound();
  }

  await prisma.recipe.delete({ where: { id } });
  await deleteStoredPhoto(recipe.photoStorageKey).catch(() => undefined);

  revalidatePath('/recipes');
  revalidatePath('/wholesale');
  redirect('/recipes?status=deleted');
}

export async function addRecipeSuggestion(formData: FormData) {
  const user = await requireUser();
  const recipeId = toOptional(formData.get('recipeId'));
  const wholesaleAccountId = toOptional(formData.get('wholesaleAccountId'));
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const note = toOptional(formData.get('note'));
  const suggestedAt = toDate(formData.get('suggestedAt')) ?? new Date();

  if (recipeId === null || wholesaleAccountId === null) {
    redirectWithStatus(returnTo, 'suggestionStatus', 'invalid');
  }

  const validRecipeId = recipeId!;
  const validWholesaleAccountId = wholesaleAccountId!;

  const [recipe, wholesaleAccount] = await Promise.all([
    prisma.recipe.findUnique({ where: { id: validRecipeId }, select: { id: true } }),
    prisma.wholesaleAccount.findUnique({ where: { id: validWholesaleAccountId }, select: { id: true } }),
  ]);

  if (!recipe || !wholesaleAccount) {
    redirectWithStatus(returnTo, 'suggestionStatus', 'invalid');
  }

  await prisma.recipeSuggestion.upsert({
    where: {
      recipeId_wholesaleAccountId: {
        recipeId: validRecipeId,
        wholesaleAccountId: validWholesaleAccountId,
      },
    },
    create: {
      recipeId: validRecipeId,
      wholesaleAccountId: validWholesaleAccountId,
      note,
      suggestedAt,
      createdByUserId: user.id,
    },
    update: {
      note,
      suggestedAt,
    },
  });

  revalidatePath('/recipes');
  revalidatePath(`/recipes/${validRecipeId}`);
  revalidatePath('/wholesale');
  revalidatePath(`/wholesale/${validWholesaleAccountId}`);
  redirectWithStatus(returnTo, 'suggestionStatus', 'added');
}

export async function removeRecipeSuggestion(formData: FormData) {
  await requireUser();
  const id = toOptional(formData.get('id'));
  const recipeId = toOptional(formData.get('recipeId'));
  const wholesaleAccountId = toOptional(formData.get('wholesaleAccountId'));
  const returnTo = safeReturnTo(formData.get('returnTo'));

  if (!id) {
    redirectWithStatus(returnTo, 'suggestionStatus', 'invalid');
  }

  await prisma.recipeSuggestion.delete({ where: { id: id! } });

  revalidatePath('/recipes');
  if (recipeId) revalidatePath(`/recipes/${recipeId}`);
  revalidatePath('/wholesale');
  if (wholesaleAccountId) revalidatePath(`/wholesale/${wholesaleAccountId}`);
  redirectWithStatus(returnTo, 'suggestionStatus', 'removed');
}
