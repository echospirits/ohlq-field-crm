'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import {
  getWholesaleLicenseeIdCreateData,
  getWholesaleLicenseeIdLookupWhere,
  getWholesaleLicenseeIdValues,
  getWholesaleCreateDataFromOfficialAccount,
  normalizeWholesaleLicenseeId,
  syncWholesaleAccountLicenseeIds,
} from '../../lib/wholesaleAccounts';

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const revalidateWholesalePaths = (accountId?: string) => {
  revalidatePath('/wholesale');
  revalidatePath('/visits/new');
  revalidatePath('/alerts');
  revalidatePath('/recipes');
  if (accountId) revalidatePath(`/wholesale/${accountId}`);
};

export async function activateOfficialWholesaleAccount(formData: FormData) {
  const user = await requireUser();
  const officialAccountId = toOptional(formData.get('officialAccountId'));

  if (!officialAccountId) {
    redirect('/wholesale?status=invalid-official');
  }

  const officialAccount = await prisma.account.findUnique({
    where: { id: officialAccountId },
    select: {
      address: true,
      agencyRefId: true,
      city: true,
      county: true,
      deliveryDay: true,
      districtId: true,
      id: true,
      licenseeId: true,
      name: true,
      ownership: true,
      phone: true,
      state: true,
      zip: true,
    },
  });

  if (!officialAccount?.licenseeId) {
    redirect('/wholesale?status=invalid-official');
  }

  const licenseeId = normalizeWholesaleLicenseeId(officialAccount.licenseeId);

  if (!licenseeId) {
    redirect('/wholesale?status=invalid-official');
  }

  const account = await prisma.$transaction(async (tx) => {
    const existingAccount = await tx.wholesaleAccount.findFirst({
      where: getWholesaleLicenseeIdLookupWhere(licenseeId),
      select: {
        id: true,
        licenseeId: true,
        licenseeIds: { select: { licenseeId: true } },
      },
    });

    if (existingAccount) {
      const updatedAccount = await tx.wholesaleAccount.update({
        where: { id: existingAccount.id },
        data: {
          isActive: true,
          officialAccountId: officialAccount.id,
        },
        select: { id: true },
      });
      await syncWholesaleAccountLicenseeIds(tx, updatedAccount.id, [
        ...getWholesaleLicenseeIdValues(existingAccount),
        licenseeId,
      ]);
      return updatedAccount;
    }

    return tx.wholesaleAccount.create({
      data: {
        ...getWholesaleCreateDataFromOfficialAccount(officialAccount, user.id),
        licenseeIds: { create: getWholesaleLicenseeIdCreateData([licenseeId]) },
      },
      select: { id: true },
    });
  });

  revalidateWholesalePaths(account.id);
  redirect(`/wholesale/${account.id}?status=activated`);
}

export async function activateWholesaleAccount(formData: FormData) {
  await requireUser();
  const id = toOptional(formData.get('id'));

  if (!id) {
    redirect('/wholesale?status=invalid');
  }

  await prisma.wholesaleAccount.update({
    where: { id },
    data: { isActive: true },
  });

  revalidateWholesalePaths(id);
  redirect(`/wholesale/${id}?status=activated`);
}
