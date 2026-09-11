'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { requireOrganizationContext } from '../../lib/organizations';
import { accountExists, getAccountContactWhere, getAccountLocation } from '../../lib/accountMemory';
import { CONTACT_IMPORT_SOURCE, hashContactImportToken, IMPORTED_CONTACT_SOURCE, validateContactImportSession } from '../../lib/contactImport';
import { normalizeContactImportField } from '../../lib/contactImportPayload';

const value = (formData: FormData, name: string) => {
  const result = String(formData.get(name) ?? '').trim();
  return result || null;
};

const returnPath = (formData: FormData) => {
  const requested = value(formData, 'returnTo');
  return requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/accounts';
};

const getLocation = (formData: FormData) => {
  const location = getAccountLocation(String(formData.get('accountType') ?? ''), String(formData.get('accountId') ?? ''));
  if (!location) redirect(`${returnPath(formData)}?memoryStatus=invalid`);
  return location;
};

export async function saveAccountNotes(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const location = getLocation(formData);
  const path = returnPath(formData);
  const accountId = location.accountType === 'AGENCY' ? location.agencyId : location.wholesaleAccountId;
  if (!(await accountExists(prisma, location))) redirect(`${path}?memoryStatus=invalid`);

  await prisma.organizationAccountOverlay.upsert({
    where: { organizationId_accountType_externalAccountId: { organizationId, accountType: location.accountType, externalAccountId: accountId } },
    create: { organizationId, accountType: location.accountType, externalAccountId: accountId, notes: value(formData, 'notes') },
    update: { notes: value(formData, 'notes') },
  });
  revalidatePath(path);
  redirect(`${path}?memoryStatus=notes-saved`);
}

export async function createAccountContact(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  let location = getLocation(formData);
  let path = returnPath(formData);
  const importSessionToken = value(formData, 'importSessionToken');
  const importSession = importSessionToken && importSessionToken.length <= 128
    ? await prisma.contactImportSession.findUnique({ where: { tokenHash: hashContactImportToken(importSessionToken) } })
    : null;
  if (importSessionToken) {
    if (!importSession || validateContactImportSession(importSession, { userId: user.id, organizationId, location }) !== 'valid') {
      redirect(`${path}?memoryStatus=invalid`);
    }
    const trustedLocation = getAccountLocation(importSession.accountType, importSession.accountId);
    if (!trustedLocation) redirect(`${path}?memoryStatus=invalid`);
    location = trustedLocation;
    path = importSession.returnPath;
  }
  const name = normalizeContactImportField(formData.get('name'), 200) || null;
  if (!name || !(await accountExists(prisma, location))) redirect(`${path}?memoryStatus=invalid`);
  const isPrimary = formData.get('isPrimary') === 'true';
  const requestedSource = value(formData, 'source');
  const source = importSession?.source === CONTACT_IMPORT_SOURCE
    ? IMPORTED_CONTACT_SOURCE
    : requestedSource === 'VCARD_IMPORT' || requestedSource === 'PHONE_CONTACT_PICKER' ? requestedSource : null;
  const externalSourceId = source === 'VCARD_IMPORT' ? value(formData, 'externalSourceId')?.slice(0, 255) ?? null : null;

  try {
    await prisma.$transaction(async (tx) => {
      if (importSession) {
        const consumed = await tx.contactImportSession.updateMany({
          where: { id: importSession.id, userId: user.id, organizationId, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1) throw new Error('CONTACT_IMPORT_REPLAYED');
      }
      if (isPrimary) await tx.locationContact.updateMany({ where: getAccountContactWhere(organizationId, location), data: { isPrimary: false } });
      await tx.locationContact.create({
        data: {
          organizationId,
          name,
          role: normalizeContactImportField(formData.get('role'), 200) || null,
          email: normalizeContactImportField(formData.get('email'), 320) || null,
          phone: normalizeContactImportField(formData.get('phone'), 100) || null,
          notes: normalizeContactImportField(formData.get('notes'), 5000) || null,
          isPrimary,
          active: true,
          source,
          externalSourceId,
          createdByUserId: user.id,
          ...(location.accountType === 'AGENCY' ? { agencyId: location.agencyId } : { wholesaleAccountId: location.wholesaleAccountId }),
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'CONTACT_IMPORT_REPLAYED') redirect(`${path}?memoryStatus=invalid`);
    throw error;
  }
  revalidatePath(path);
  redirect(`${path}?memoryStatus=contact-saved`);
}

export async function updateAccountContact(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const location = getLocation(formData);
  const path = returnPath(formData);
  const id = value(formData, 'contactId');
  const name = value(formData, 'name');
  if (!id || !name) redirect(`${path}?memoryStatus=invalid`);
  const contact = await prisma.locationContact.findFirst({ where: { id, ...getAccountContactWhere(organizationId, location) }, select: { id: true } });
  if (!contact) redirect(`${path}?memoryStatus=invalid`);
  const isPrimary = formData.get('isPrimary') === 'true';
  const active = formData.get('active') === 'true';

  await prisma.$transaction(async (tx) => {
    if (isPrimary) await tx.locationContact.updateMany({ where: { ...getAccountContactWhere(organizationId, location), id: { not: id } }, data: { isPrimary: false } });
    await tx.locationContact.update({
      where: { id },
      data: { name, role: value(formData, 'role'), email: value(formData, 'email'), phone: value(formData, 'phone'), notes: value(formData, 'notes'), isPrimary, active },
    });
  });
  revalidatePath(path);
  redirect(`${path}?memoryStatus=contact-saved`);
}
