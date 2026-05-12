import { del, put } from '@vercel/blob';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const extensionByContentType: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type UploadedVisitPhoto = {
  url: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
};

export type UploadedRecipePhoto = UploadedVisitPhoto;
export type UploadedMenuPlacementProof = UploadedVisitPhoto;

export function validatePhotoFile(file: File) {
  if (!file.type.startsWith('image/')) {
    return 'invalid-photo';
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return 'photo-too-large';
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return 'storage-not-configured';
  }

  return null;
}

export const validateVisitPhotoFile = validatePhotoFile;
export const validateRecipePhotoFile = validatePhotoFile;
export const validateMenuPlacementProofFile = validatePhotoFile;

export async function uploadVisitPhoto(file: File, visitId: string, userId: string, index: number) {
  const extension = extensionByContentType[file.type] ?? 'jpg';
  const storageKey = `visit-photos/${visitId}/${Date.now()}-${index}-${userId}.${extension}`;
  const blob = await put(storageKey, file, {
    access: 'public',
    contentType: file.type,
  });

  return {
    url: blob.url,
    storageKey,
    contentType: file.type,
    sizeBytes: file.size,
  } satisfies UploadedVisitPhoto;
}

export async function uploadRecipePhoto(file: File, recipeId: string, userId: string) {
  const extension = extensionByContentType[file.type] ?? 'jpg';
  const storageKey = `recipe-photos/${recipeId}/${Date.now()}-${userId}.${extension}`;
  const blob = await put(storageKey, file, {
    access: 'public',
    contentType: file.type,
  });

  return {
    url: blob.url,
    storageKey: blob.pathname ?? storageKey,
    contentType: file.type,
    sizeBytes: file.size,
  } satisfies UploadedRecipePhoto;
}

export async function uploadMenuPlacementProof(file: File, accountId: string, userId: string) {
  const extension = extensionByContentType[file.type] ?? 'jpg';
  const storageKey = `menu-placement-proofs/${accountId}/${Date.now()}-${userId}.${extension}`;
  const blob = await put(storageKey, file, {
    access: 'public',
    contentType: file.type,
  });

  return {
    url: blob.url,
    storageKey: blob.pathname ?? storageKey,
    contentType: file.type,
    sizeBytes: file.size,
  } satisfies UploadedMenuPlacementProof;
}

export async function deleteStoredPhoto(urlOrPathname: string | null | undefined) {
  if (!urlOrPathname || !process.env.BLOB_READ_WRITE_TOKEN) {
    return;
  }

  await del(urlOrPathname);
}
