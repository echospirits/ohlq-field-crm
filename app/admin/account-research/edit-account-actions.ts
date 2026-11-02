'use server';

import { z } from 'zod';
import { requireEchoAdmin } from '../../../lib/auth';
import { requireFeatureForUser, requireOrganizationContext } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { getWholesaleLicenseeIdValues } from '../../../lib/wholesaleAccounts';
import type { WholesaleAccountEditValues } from '../../components/WholesaleAccountEditFields';
import { saveWholesaleAccount } from '../../wholesale/[id]/edit/actions';

export async function loadResearchAccountEditor(accountId: string): Promise<{ account: WholesaleAccountEditValues } | { error: string }> {
  const user = await requireEchoAdmin();
  await requireOrganizationContext(user);
  await requireFeatureForUser(user, 'ADVANCED_INTELLIGENCE');
  const parsed = z.string().trim().min(1).max(200).safeParse(accountId);
  if (!parsed.success) return { error: 'Choose an account to edit.' };
  const account = await prisma.wholesaleAccount.findUnique({
    where: { id: parsed.data },
    select: {
      id: true, name: true, licenseeId: true,
      licenseeIds: { orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }], select: { licenseeId: true } },
      address: true, city: true, state: true, zip: true, county: true,
      phone: true, agencyId: true, districtId: true, ownership: true, deliveryDay: true,
      addressImportProtected: true, cityImportProtected: true, zipImportProtected: true, mergedIntoId: true,
    },
  });
  if (!account) return { error: 'This account is no longer available. Refresh the list to continue.' };
  if (account.mergedIntoId) return { error: 'This account was merged. Refresh the list or open the account to see its current record.' };
  const { mergedIntoId: _mergedIntoId, licenseeId: _licenseeId, ...values } = account;
  return { account: { ...values, licenseeIds: getWholesaleLicenseeIdValues(account) } };
}

export async function saveResearchAccount(formData: FormData) {
  const user = await requireEchoAdmin();
  await requireOrganizationContext(user);
  await requireFeatureForUser(user, 'ADVANCED_INTELLIGENCE');
  return saveWholesaleAccount(formData);
}
