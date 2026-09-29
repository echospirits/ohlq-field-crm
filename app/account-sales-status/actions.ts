'use server';

import { AccountSalesStatusSource, SalesAccountType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import { parseSalesStatus, setAccountSalesStatus } from '../../lib/accountSalesStatus';
import { requireFeatureForUser } from '../../lib/organizations';
import { prisma } from '../../lib/prisma';

const safeReturnTo = (value: FormDataEntryValue | null) => {
  const path = String(value ?? '');
  return path.startsWith('/') && !path.startsWith('//') ? path : '/pipeline';
};

export async function updateAccountSalesStatus(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'ACCOUNT_SALES_STATUS');
  const accountType = String(formData.get('accountType')) === SalesAccountType.AGENCY ? SalesAccountType.AGENCY : SalesAccountType.WHOLESALE;
  const externalAccountId = String(formData.get('externalAccountId') ?? '');
  const status = parseSalesStatus(formData.get('salesStatus'));
  const returnTo = safeReturnTo(formData.get('returnTo'));
  if (!externalAccountId || !status) redirect(`${returnTo}?salesStatus=invalid`);
  await prisma.$transaction((tx) => setAccountSalesStatus({ accountType, changedByUserId: user.id, db: tx, externalAccountId, organizationId, source: AccountSalesStatusSource.USER, status }));
  revalidatePath(returnTo);
  revalidatePath('/pipeline');
  redirect(`${returnTo}?salesStatus=saved`);
}
