'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';

const defaultTagColor = '#7c9cff';
const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeTagName = (value: FormDataEntryValue | null | undefined) =>
  String(value ?? '').trim().replace(/\s+/g, ' ');

const toTagColor = (value: FormDataEntryValue | null | undefined) => {
  const color = String(value ?? '').trim();
  return hexColorPattern.test(color) ? color : defaultTagColor;
};

const safeReturnTo = (value: FormDataEntryValue | null | undefined, fallback = '/tags') => {
  const path = toOptional(value);
  return path && path.startsWith('/') && !path.startsWith('//') ? path : fallback;
};

export async function createTag(formData: FormData) {
  const user = await requireUser();
  const name = normalizeTagName(formData.get('name'));

  if (!name) {
    redirect('/tags?status=invalid');
  }

  await prisma.tag.upsert({
    where: { name },
    create: {
      name,
      color: toTagColor(formData.get('color')),
      description: toOptional(formData.get('description')),
      createdByUserId: user.id,
    },
    update: {
      color: toTagColor(formData.get('color')),
      description: toOptional(formData.get('description')),
    },
  });

  revalidatePath('/tags');
  revalidatePath('/agencies');
  revalidatePath('/wholesale');
  redirect('/tags?status=saved');
}

export async function deleteTag(formData: FormData) {
  await requireUser();
  const id = toOptional(formData.get('id'));

  if (!id) {
    redirect('/tags?status=invalid');
  }

  await prisma.tag.delete({ where: { id } });

  revalidatePath('/tags');
  revalidatePath('/agencies');
  revalidatePath('/wholesale');
  redirect('/tags?status=deleted');
}

export async function addLocationTag(formData: FormData) {
  const user = await requireUser();
  const tagId = toOptional(formData.get('tagId'));
  const agencyId = toOptional(formData.get('agencyId'));
  const wholesaleAccountId = toOptional(formData.get('wholesaleAccountId'));
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const note = toOptional(formData.get('note'));

  if (!tagId || (!agencyId && !wholesaleAccountId) || (agencyId && wholesaleAccountId)) {
    redirect(`${returnTo}?tagStatus=invalid`);
  }

  if (agencyId) {
    await prisma.locationTag.upsert({
      where: { tagId_agencyId: { tagId, agencyId } },
      create: {
        tagId,
        agencyId,
        note,
        createdByUserId: user.id,
      },
      update: {
        note,
      },
    });
  }

  if (wholesaleAccountId) {
    await prisma.locationTag.upsert({
      where: { tagId_wholesaleAccountId: { tagId, wholesaleAccountId } },
      create: {
        tagId,
        wholesaleAccountId,
        note,
        createdByUserId: user.id,
      },
      update: {
        note,
      },
    });
  }

  revalidatePath('/tags');
  revalidatePath('/agencies');
  revalidatePath('/wholesale');
  if (agencyId) revalidatePath(`/agencies/${agencyId}`);
  if (wholesaleAccountId) revalidatePath(`/wholesale/${wholesaleAccountId}`);
  redirect(`${returnTo}?tagStatus=added`);
}

export async function removeLocationTag(formData: FormData) {
  await requireUser();
  const id = toOptional(formData.get('id'));
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const agencyId = toOptional(formData.get('agencyId'));
  const wholesaleAccountId = toOptional(formData.get('wholesaleAccountId'));

  if (!id) {
    redirect(`${returnTo}?tagStatus=invalid`);
  }

  await prisma.locationTag.delete({ where: { id } });

  revalidatePath('/tags');
  revalidatePath('/agencies');
  revalidatePath('/wholesale');
  if (agencyId) revalidatePath(`/agencies/${agencyId}`);
  if (wholesaleAccountId) revalidatePath(`/wholesale/${wholesaleAccountId}`);
  redirect(`${returnTo}?tagStatus=removed`);
}
