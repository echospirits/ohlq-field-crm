'use server';

import {
  AccountType,
  MenuPlacementSource,
  MenuPlacementStatus,
  MenuPlacementType,
  PhotoType,
} from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import {
  deleteStoredPhoto,
  uploadMenuPlacementProof,
  validateMenuPlacementProofFile,
} from '../../lib/blob';
import { prisma } from '../../lib/prisma';

type ProofInput =
  | { type: 'none' }
  | { type: 'remove' }
  | { type: 'url'; url: string }
  | { type: 'file'; file: File };

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toDate = (value: FormDataEntryValue | null | undefined) => {
  const date = toOptional(value);
  return date ? new Date(`${date}T12:00:00`) : null;
};

const safeReturnTo = (value: FormDataEntryValue | null | undefined, fallback = '/wholesale') => {
  const path = toOptional(value);
  return path && path.startsWith('/') && !path.startsWith('//') ? path : fallback;
};

const redirectWithPlacementStatus = (returnTo: string, status: string): never => {
  const separator = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${separator}placementStatus=${status}`);
};

const toPlacementType = (value: FormDataEntryValue | null | undefined) => {
  const placementType = String(value ?? MenuPlacementType.COCKTAIL_MENU);
  return Object.values(MenuPlacementType).includes(placementType as MenuPlacementType)
    ? (placementType as MenuPlacementType)
    : MenuPlacementType.COCKTAIL_MENU;
};

const toPlacementStatus = (value: FormDataEntryValue | null | undefined) => {
  const status = String(value ?? MenuPlacementStatus.PROMISED);
  return Object.values(MenuPlacementStatus).includes(status as MenuPlacementStatus)
    ? (status as MenuPlacementStatus)
    : MenuPlacementStatus.PROMISED;
};

const toPlacementSource = (value: FormDataEntryValue | null | undefined) => {
  const source = String(value ?? MenuPlacementSource.MANUAL);
  return Object.values(MenuPlacementSource).includes(source as MenuPlacementSource)
    ? (source as MenuPlacementSource)
    : MenuPlacementSource.MANUAL;
};

function getProofInput(formData: FormData, returnTo: string): ProofInput {
  const removeProof = String(formData.get('removeProof') ?? '') === 'on';
  const proofUrl = toOptional(formData.get('proofUrl'));
  const proofFile = formData.get('proofFile');

  if (proofFile instanceof File && proofFile.size > 0) {
    const validationError = validateMenuPlacementProofFile(proofFile);

    if (validationError) {
      redirectWithPlacementStatus(returnTo, validationError);
    }

    return { type: 'file', file: proofFile };
  }

  if (proofUrl) {
    return { type: 'url', url: proofUrl };
  }

  if (removeProof) {
    return { type: 'remove' };
  }

  return { type: 'none' };
}

async function ensureAccountForWholesale(wholesaleAccountId: string) {
  const wholesaleAccount = await prisma.wholesaleAccount.findUnique({
    where: { id: wholesaleAccountId },
  });

  if (!wholesaleAccount) {
    notFound();
  }

  return prisma.account.upsert({
    where: { licenseeId: wholesaleAccount.licenseeId },
    create: {
      licenseeId: wholesaleAccount.licenseeId,
      agencyRefId: wholesaleAccount.agencyId,
      type: AccountType.BAR_RESTAURANT,
      name: wholesaleAccount.name,
      address: wholesaleAccount.address,
      city: wholesaleAccount.city,
      county: wholesaleAccount.county,
      state: wholesaleAccount.state ?? 'OH',
      zip: wholesaleAccount.zip,
      phone: wholesaleAccount.phone,
      ownership: wholesaleAccount.ownership,
      districtId: wholesaleAccount.districtId,
    },
    update: {
      agencyRefId: wholesaleAccount.agencyId,
      name: wholesaleAccount.name,
      address: wholesaleAccount.address,
      city: wholesaleAccount.city,
      county: wholesaleAccount.county,
      state: wholesaleAccount.state ?? 'OH',
      zip: wholesaleAccount.zip,
      phone: wholesaleAccount.phone,
      ownership: wholesaleAccount.ownership,
      districtId: wholesaleAccount.districtId,
    },
  });
}

function getPlacementData(formData: FormData) {
  const product = toOptional(formData.get('product'));
  const menuItemName = toOptional(formData.get('menuItemName'));

  return {
    product,
    menuItemName,
    placementType: toPlacementType(formData.get('placementType')),
    status: toPlacementStatus(formData.get('status')),
    source: toPlacementSource(formData.get('source')),
    firstSeenAt: toDate(formData.get('firstSeenAt')),
    lastVerifiedAt: toDate(formData.get('lastVerifiedAt')),
    expectedEndAt: toDate(formData.get('expectedEndAt')),
    notes: toOptional(formData.get('notes')),
    assignedToUserId: toOptional(formData.get('assignedToUserId')),
  };
}

async function createProofPhoto({
  accountId,
  caption,
  proofInput,
  userId,
  visitId,
}: {
  accountId: string;
  caption: string;
  proofInput: Exclude<ProofInput, { type: 'none' | 'remove' }>;
  userId: string;
  visitId: string | null;
}) {
  const proof =
    proofInput.type === 'file'
      ? await uploadMenuPlacementProof(proofInput.file, accountId, userId)
      : {
          url: proofInput.url,
          storageKey: null,
          contentType: null,
          sizeBytes: null,
        };

  const photo = await prisma.photo.create({
    data: {
      accountId,
      visitId,
      type: PhotoType.MENU,
      url: proof.url,
      caption,
    },
  });

  return {
    photo,
    proofUrl: proof.url,
    proofStorageKey: proof.storageKey,
    proofContentType: proof.contentType,
    proofSizeBytes: proof.sizeBytes,
  };
}

export async function createMenuPlacement(formData: FormData) {
  const user = await requireUser();
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const wholesaleAccountId = toOptional(formData.get('wholesaleAccountId'));
  const directAccountId = toOptional(formData.get('accountId'));
  const visitId = toOptional(formData.get('visitId'));
  const placementData = getPlacementData(formData);

  if (!placementData.product || !placementData.menuItemName || (!directAccountId && !wholesaleAccountId)) {
    redirectWithPlacementStatus(returnTo, 'invalid');
  }

  const product = placementData.product!;
  const menuItemName = placementData.menuItemName!;

  const account = directAccountId
    ? await prisma.account.findUnique({ where: { id: directAccountId } })
    : await ensureAccountForWholesale(wholesaleAccountId!);

  if (!account) {
    notFound();
  }

  const proofInput = getProofInput(formData, returnTo);
  const proof =
    proofInput.type === 'file' || proofInput.type === 'url'
      ? await createProofPhoto({
          accountId: account.id,
          caption: `Menu proof: ${menuItemName}`,
          proofInput,
          userId: user.id,
          visitId,
        })
      : null;

  await prisma.menuPlacement.create({
    data: {
      accountId: account.id,
      wholesaleAccountId,
      visitId,
      product,
      menuItemName,
      placementType: placementData.placementType,
      status: placementData.status,
      source: placementData.source,
      firstSeenAt: placementData.firstSeenAt,
      lastVerifiedAt: placementData.lastVerifiedAt,
      expectedEndAt: placementData.expectedEndAt,
      notes: placementData.notes,
      assignedToUserId: placementData.assignedToUserId,
      createdByUserId: user.id,
      updatedByUserId: user.id,
      proofPhotoId: proof?.photo.id,
      proofUrl: proof?.proofUrl,
      proofStorageKey: proof?.proofStorageKey,
      proofContentType: proof?.proofContentType,
      proofSizeBytes: proof?.proofSizeBytes,
    },
  });

  revalidatePath('/');
  revalidatePath('/wholesale');
  if (wholesaleAccountId) revalidatePath(`/wholesale/${wholesaleAccountId}`);
  redirectWithPlacementStatus(returnTo, 'created');
}

export async function updateMenuPlacement(formData: FormData) {
  const user = await requireUser();
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const id = toOptional(formData.get('id'));

  if (!id) {
    redirectWithPlacementStatus(returnTo, 'invalid');
  }

  const placementId = id!;

  const existingPlacement = await prisma.menuPlacement.findUnique({
    where: { id: placementId },
  });

  if (!existingPlacement) {
    notFound();
  }

  const placementData = getPlacementData(formData);

  if (!placementData.product || !placementData.menuItemName) {
    redirectWithPlacementStatus(returnTo, 'invalid');
  }

  const product = placementData.product!;
  const menuItemName = placementData.menuItemName!;

  const proofInput = getProofInput(formData, returnTo);
  const proof =
    proofInput.type === 'file' || proofInput.type === 'url'
      ? await createProofPhoto({
          accountId: existingPlacement.accountId,
          caption: `Menu proof: ${menuItemName}`,
          proofInput,
          userId: user.id,
          visitId: existingPlacement.visitId,
        })
      : null;
  const shouldRemoveOldProof = proofInput.type === 'remove' || !!proof;

  await prisma.menuPlacement.update({
    where: { id: placementId },
    data: {
      product,
      menuItemName,
      placementType: placementData.placementType,
      status: placementData.status,
      source: placementData.source,
      firstSeenAt: placementData.firstSeenAt,
      lastVerifiedAt: placementData.lastVerifiedAt,
      expectedEndAt: placementData.expectedEndAt,
      notes: placementData.notes,
      assignedToUserId: placementData.assignedToUserId,
      updatedByUserId: user.id,
      proofPhotoId: shouldRemoveOldProof ? proof?.photo.id ?? null : undefined,
      proofUrl: shouldRemoveOldProof ? proof?.proofUrl ?? null : undefined,
      proofStorageKey: shouldRemoveOldProof ? proof?.proofStorageKey ?? null : undefined,
      proofContentType: shouldRemoveOldProof ? proof?.proofContentType ?? null : undefined,
      proofSizeBytes: shouldRemoveOldProof ? proof?.proofSizeBytes ?? null : undefined,
    },
  });

  if (shouldRemoveOldProof && existingPlacement.proofPhotoId) {
    await prisma.photo.delete({ where: { id: existingPlacement.proofPhotoId } }).catch(() => undefined);
  }

  if (shouldRemoveOldProof && existingPlacement.proofStorageKey) {
    await deleteStoredPhoto(existingPlacement.proofStorageKey).catch(() => undefined);
  }

  revalidatePath('/');
  revalidatePath('/wholesale');
  if (existingPlacement.wholesaleAccountId) revalidatePath(`/wholesale/${existingPlacement.wholesaleAccountId}`);
  redirectWithPlacementStatus(returnTo, 'updated');
}

export async function deleteMenuPlacement(formData: FormData) {
  await requireUser();
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const id = toOptional(formData.get('id'));

  if (!id) {
    redirectWithPlacementStatus(returnTo, 'invalid');
  }

  const placementId = id!;

  const placement = await prisma.menuPlacement.findUnique({
    where: { id: placementId },
    select: {
      proofPhotoId: true,
      proofStorageKey: true,
      wholesaleAccountId: true,
    },
  });

  if (!placement) {
    notFound();
  }

  await prisma.menuPlacement.delete({ where: { id: placementId } });

  if (placement.proofPhotoId) {
    await prisma.photo.delete({ where: { id: placement.proofPhotoId } }).catch(() => undefined);
  }

  if (placement.proofStorageKey) {
    await deleteStoredPhoto(placement.proofStorageKey).catch(() => undefined);
  }

  revalidatePath('/');
  revalidatePath('/wholesale');
  if (placement.wholesaleAccountId) revalidatePath(`/wholesale/${placement.wholesaleAccountId}`);
  redirectWithPlacementStatus(returnTo, 'deleted');
}
