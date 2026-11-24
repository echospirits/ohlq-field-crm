'use client';

import { unstable_rethrow } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { beginVisitSave, failVisitSave, markVisitResponse } from './visitTimingClient';
import {
  AGENCY_VISIT_PHOTO_LONG_SIDE,
  fitImageWithinLongSide,
  fitWholesaleVisitPhoto,
  getVisitPhotoUploadPrefix,
  MAX_AGENCY_VISIT_PHOTO_BYTES,
  MAX_VISIT_PHOTO_BYTES,
  type VisitPhotoLocationType,
} from '../../lib/visitPhotoUploadShared';

type DecodedImage = {
  cleanup: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
};

const loadImageElement = (file: File) =>
  new Promise<DecodedImage>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () =>
      resolve({
        cleanup: () => URL.revokeObjectURL(url),
        height: image.naturalHeight,
        source: image,
        width: image.naturalWidth,
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Photo format could not be decoded'));
    };
    image.src = url;
  });

const decodePhoto = async (file: File): Promise<DecodedImage> => {
  if (typeof createImageBitmap !== 'function') {
    return loadImageElement(file);
  }

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      cleanup: () => bitmap.close(),
      height: bitmap.height,
      source: bitmap,
      width: bitmap.width,
    };
  } catch {
    return loadImageElement(file);
  }
};

const renderJpeg = (
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
) =>
  new Promise<Blob>((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      reject(new Error('Photo processing is not supported by this browser'));
      return;
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Photo could not be compressed'))),
      'image/jpeg',
      quality,
    );
  });

const toJpegFile = (sourceFile: File, blob: Blob) => {
  const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || 'visit-photo';
  return new File([blob], `${baseName}.jpg`, {
    lastModified: sourceFile.lastModified,
    type: 'image/jpeg',
  });
};

async function compressAgencyPhoto(file: File, image: DecodedImage) {
  let dimensions = fitImageWithinLongSide(image.width, image.height, AGENCY_VISIT_PHOTO_LONG_SIDE);
  let quality = 0.82;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const blob = await renderJpeg(image.source, dimensions.width, dimensions.height, quality);
    if (blob.size < MAX_AGENCY_VISIT_PHOTO_BYTES) return toJpegFile(file, blob);

    if (quality > 0.42) {
      quality = Math.max(0.42, quality - 0.1);
    } else {
      dimensions = {
        height: Math.max(1, Math.round(dimensions.height * 0.82)),
        width: Math.max(1, Math.round(dimensions.width * 0.82)),
      };
      quality = 0.72;
    }
  }

  throw new Error('Photo could not be reduced below 200 KB');
}

async function compressWholesalePhoto(file: File, image: DecodedImage) {
  let dimensions = fitWholesaleVisitPhoto(image.width, image.height);
  let quality = 0.85;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const blob = await renderJpeg(image.source, dimensions.width, dimensions.height, quality);
    if (blob.size <= MAX_VISIT_PHOTO_BYTES) return toJpegFile(file, blob);

    if (quality > 0.45) {
      quality = Math.max(0.45, quality - 0.1);
    } else {
      dimensions = {
        height: Math.max(1, Math.round(dimensions.height * 0.85)),
        width: Math.max(1, Math.round(dimensions.width * 0.85)),
      };
      quality = 0.75;
    }
  }

  throw new Error('Photo could not be reduced below the upload limit');
}

export async function prepareVisitPhoto(file: File, locationType: VisitPhotoLocationType) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Invalid image content type');
  }

  const image = await decodePhoto(file);
  try {
    return locationType === 'agency'
      ? await compressAgencyPhoto(file, image)
      : await compressWholesalePhoto(file, image);
  } finally {
    image.cleanup();
  }
}

const replaceEntries = (formData: FormData, name: string, values: Array<string | Blob>) => {
  formData.delete(name);
  values.forEach((value) => formData.append(name, value));
};

const getPhotoUploadErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';

  if (/too large|maximum|size/i.test(message)) {
    return 'Each uploaded photo must be 5 MB or smaller.';
  }

  if (/content.?type|invalid image/i.test(message)) {
    return 'Photos must be image files.';
  }

  if (/decode|format/i.test(message)) {
    return 'This photo format could not be processed. Try choosing a JPEG, PNG, or WebP photo.';
  }

  if (/compressed|reduced|processing/i.test(message)) {
    return 'The photo could not be reduced for upload. Try a different photo.';
  }

  return 'The photo could not be uploaded. Check your connection and try again.';
};

export async function uploadVisitPhotoFiles(formData: FormData) {
  const files = formData.getAll('photoFile');
  if (!files.some((file) => file instanceof File && file.size > 0)) {
    formData.delete('photoFile');
    return;
  }
  const { upload } = await import('@vercel/blob/client');
  const locationType: VisitPhotoLocationType = formData.get('locationType') === 'agency' ? 'agency' : 'wholesale';
  const urls = formData.getAll('photoUrl').map((value) => String(value ?? ''));
  const photoCount = Math.max(files.length, urls.length);
  const storageKeys = Array.from({ length: photoCount }, () => '');
  const contentTypes = Array.from({ length: photoCount }, () => '');
  const sizeBytes = Array.from({ length: photoCount }, () => '');
  const sessionId = crypto.randomUUID();
  const uploadPrefix = getVisitPhotoUploadPrefix(sessionId);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!(file instanceof File) || file.size === 0) continue;

    const preparedFile = await prepareVisitPhoto(file, locationType);
    const pathname = `${uploadPrefix}${index}-${crypto.randomUUID()}.jpg`;
    const blob = await upload(pathname, preparedFile, {
      access: 'public',
      clientPayload: JSON.stringify({ sessionId }),
      contentType: preparedFile.type,
      handleUploadUrl: '/api/visit-photos/upload',
    });

    urls[index] = blob.url;
    storageKeys[index] = blob.pathname;
    contentTypes[index] = blob.contentType;
    sizeBytes[index] = String(preparedFile.size);
  }

  formData.set('photoUploadSessionId', sessionId);
  formData.delete('photoFile');
  replaceEntries(formData, 'photoUrl', urls);
  replaceEntries(formData, 'photoStorageKey', storageKeys);
  replaceEntries(formData, 'photoContentType', contentTypes);
  replaceEntries(formData, 'photoSizeBytes', sizeBytes);
}

export function useVisitPhotoFormAction(action: (formData: FormData) => void | Promise<void>, trackConfirmation: boolean) {
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const retryAttempt = useRef(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    const formData = new FormData(event.currentTarget);
    if (formData.has('submissionKey') && !formData.get('submissionKey')) return;
    submitting.current = true;
    const timing = trackConfirmation ? beginVisitSave(formData, retryAttempt.current) : null;
    setPhotoUploadError(null);
    window.requestAnimationFrame(() => markVisitResponse(timing));

    // Keep the DOM form intact on failure, including file inputs and any
    // uncontrolled fields. React resets those fields when a form action resolves.
    startTransition(async () => {
      try {
        await uploadVisitPhotoFiles(formData);
      } catch (error) {
        retryAttempt.current = true;
        failVisitSave(timing);
        setPhotoUploadError(getPhotoUploadErrorMessage(error));
        submitting.current = false;
        return;
      }

      try {
        await action(formData);
      } catch (error) {
        unstable_rethrow(error);
        retryAttempt.current = true;
        failVisitSave(timing);
        setPhotoUploadError('Save could not be confirmed. Check your connection and retry.');
      } finally {
        submitting.current = false;
      }
    });
  };

  return { handleSubmit, pending, photoUploadError };
}
