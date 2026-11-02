'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AccountType } from '@prisma/client';
import { z } from 'zod';
import type { ActionResult } from '../../../components/ActionForm';
import { refreshTenantOpportunityScoresForAccounts } from '../../../../lib/accountResearchScoring';
import { requireEchoAdmin } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { normalizeUsState, stateScopedLicenseeIds } from '../../../../lib/usStates';
import { getGeocodeResetForAddressChange } from '../../../../lib/location/geocode';
import { getWholesaleAddressProtectionForEdit } from '../../../../lib/wholesaleAddressProtection';
import {
  chooseWholesaleOfficialAccountCandidate,
  getWholesaleOfficialAccountSearchConditions,
  getWholesaleOfficialLookupLicenseeIds,
  getPrimaryWholesaleLicenseeId,
  getWholesaleEditableValuesFromOfficialAccount,
  getWholesaleLicenseeIdConflictWhere,
  getWholesaleLicenseeIdValues,
  isGeneratedWholesaleLicenseeId,
  mergeWholesaleEditableValuesWithOfficialDefaults,
  moveWholesaleLicenseeIdToPrimary,
  normalizeWholesaleLicenseeId,
  parseWholesaleLicenseeIds,
  syncWholesaleAccountLicenseeIds,
  type WholesaleAccountEditableValues,
  wholesaleLicenseeIdListsMatch,
} from '../../../../lib/wholesaleAccounts';

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

async function findOfficialWholesaleAccountByLicenseeIds({
  existingLicenseeId,
  existingLicenseeIds,
  licenseeIds,
}: {
  existingLicenseeId: string | null;
  existingLicenseeIds: string[];
  licenseeIds: string[];
}) {
  const lookupLicenseeIds = getWholesaleOfficialLookupLicenseeIds({
    existingLicenseeId,
    existingLicenseeIds,
    licenseeIds,
  });
  const searchConditions = getWholesaleOfficialAccountSearchConditions(lookupLicenseeIds);

  if (searchConditions.length === 0) {
    return null;
  }

  const candidates = await prisma.account.findMany({
    where: {
      type: AccountType.BAR_RESTAURANT,
      OR: searchConditions,
    },
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
      officialWholesale: { select: { id: true } },
      ownership: true,
      phone: true,
      state: true,
      zip: true,
    },
    take: 250,
  });

  const agencyRefIds = Array.from(
    new Set(candidates.map((candidate) => candidate.agencyRefId).filter(Boolean) as string[]),
  );
  const liquorAgencies =
    agencyRefIds.length > 0
      ? await prisma.account.findMany({
          where: {
            agencyId: { in: agencyRefIds },
            type: AccountType.LIQUOR_AGENCY,
          },
          select: {
            address: true,
            agencyId: true,
            city: true,
            state: true,
            zip: true,
          },
        })
      : [];

  return chooseWholesaleOfficialAccountCandidate({
    candidates,
    liquorAgencies,
    lookupLicenseeIds,
  });
}

export async function saveWholesaleAccount(formData: FormData): Promise<ActionResult> {
  await requireEchoAdmin();

  const parsed = z.object({
    id: z.string().trim().min(1, 'Choose an account to edit.'),
    name: z.string().trim().min(1, 'Account name is required.'),
    licenseeIds: z.string().trim().min(1, 'At least one Licensee ID is required.'),
    state: z.string(),
    address: z.string().nullable(), agencyId: z.string().nullable(), city: z.string().nullable(),
    county: z.string().nullable(), deliveryDay: z.string().nullable(), districtId: z.string().nullable(),
    ownership: z.string().nullable(), phone: z.string().nullable(), zip: z.string().nullable(),
  }).safeParse({
    id: formData.get('id'), name: formData.get('name'),
    licenseeIds: formData.get('licenseeIds') ?? formData.get('licenseeId'),
    state: formData.get('state') ?? 'OH',
    ...Object.fromEntries(['address', 'agencyId', 'city', 'county', 'deliveryDay', 'districtId', 'ownership', 'phone', 'zip']
      .map((field) => [field, formData.get(field)])),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the account details and try again.' };
  const input = parsed.data;
  const id = input.id;
  const state = normalizeUsState(input.state);
  if (!state) return { error: 'Enter a valid US state name or two-letter abbreviation.' };
  const submittedLicenseeIds = stateScopedLicenseeIds(parseWholesaleLicenseeIds(
    input.licenseeIds,
  ), state);
  const submittedLicenseeId = getPrimaryWholesaleLicenseeId(submittedLicenseeIds);
  const name = input.name;

  if (!id || !submittedLicenseeId || !name) {
    return { error: 'Name and at least one Licensee ID are required.' };
  }

  const existingAccount = await prisma.wholesaleAccount.findUnique({
    where: { id },
    select: {
      address: true,
      agencyId: true,
      addressImportProtected: true,
      city: true,
      cityImportProtected: true,
      county: true,
      deliveryDay: true,
      districtId: true,
      id: true,
      licenseeId: true,
      licenseeIds: { select: { licenseeId: true } },
      mergedIntoId: true,
      name: true,
      officialAccountId: true,
      ownership: true,
      phone: true,
      state: true,
      zip: true,
      zipImportProtected: true,
    },
  });

  if (!existingAccount) {
    return { error: 'This account is no longer available. Refresh the list and try again.', refresh: true };
  }
  if (existingAccount.mergedIntoId) {
    return { error: 'This account was merged. Open the current account to edit its details.', refresh: true };
  }

  const existingLicenseeIds = getWholesaleLicenseeIdValues(existingAccount);
  const licenseeIdsChanged = !wholesaleLicenseeIdListsMatch(existingLicenseeIds, submittedLicenseeIds);
  const shouldRefreshOfficialAccount = state === 'OH' && (licenseeIdsChanged || Boolean(existingAccount.officialAccountId));
  const officialAccount = shouldRefreshOfficialAccount
    ? await findOfficialWholesaleAccountByLicenseeIds({
        existingLicenseeId: existingAccount.licenseeId,
        existingLicenseeIds,
        licenseeIds: submittedLicenseeIds,
      })
    : null;
  const officialLicenseeId = normalizeWholesaleLicenseeId(officialAccount?.licenseeId);
  const shouldPromoteOfficialLicenseeId =
    isGeneratedWholesaleLicenseeId(existingAccount.licenseeId) || isGeneratedWholesaleLicenseeId(submittedLicenseeId);
  const licenseeIds =
    shouldPromoteOfficialLicenseeId && officialLicenseeId
      ? moveWholesaleLicenseeIdToPrimary(submittedLicenseeIds, officialLicenseeId)
      : submittedLicenseeIds;
  const licenseeId = getPrimaryWholesaleLicenseeId(licenseeIds);

  if (!licenseeId) {
    return { error: 'At least one Licensee ID is required.' };
  }

  const accountWithLicenseeId = await prisma.wholesaleAccount.findFirst({
    where: getWholesaleLicenseeIdConflictWhere(licenseeIds, id),
    select: { id: true },
  });

  if (accountWithLicenseeId && accountWithLicenseeId.id !== id) {
    return { error: 'Another restaurant account already uses one of those Licensee IDs.' };
  }

  const submittedValues: WholesaleAccountEditableValues = {
    address: toOptional(input.address),
    agencyId: toOptional(input.agencyId),
    city: toOptional(input.city),
    county: toOptional(input.county),
    deliveryDay: toOptional(input.deliveryDay),
    districtId: toOptional(input.districtId),
    name,
    ownership: toOptional(input.ownership),
    phone: toOptional(input.phone),
    state,
    zip: toOptional(input.zip),
  };
  const officialAccountChanged = Boolean(officialAccount && officialAccount.id !== existingAccount.officialAccountId);

  if (officialAccount?.officialWholesale && officialAccount.officialWholesale.id !== id) {
    return { error: 'That official account is already linked to another restaurant account.' };
  }

  const existingValues: WholesaleAccountEditableValues = {
    address: existingAccount.address,
    agencyId: existingAccount.agencyId,
    city: existingAccount.city,
    county: existingAccount.county,
    deliveryDay: existingAccount.deliveryDay,
    districtId: existingAccount.districtId,
    name: existingAccount.name,
    ownership: existingAccount.ownership,
    phone: existingAccount.phone,
    state: existingAccount.state ?? 'OH',
    zip: existingAccount.zip,
  };
  const addressProtection = getWholesaleAddressProtectionForEdit(existingAccount, submittedValues);
  const mergedValues =
    officialAccount && (licenseeIdsChanged || officialAccountChanged)
      ? mergeWholesaleEditableValuesWithOfficialDefaults({
          existingValues,
          officialValues: getWholesaleEditableValuesFromOfficialAccount(officialAccount),
          submittedValues,
        })
      : submittedValues;
  const accountValues = {
    ...mergedValues,
    address: addressProtection.addressImportProtected ? submittedValues.address : mergedValues.address,
    city: addressProtection.cityImportProtected ? submittedValues.city : mergedValues.city,
    zip: addressProtection.zipImportProtected ? submittedValues.zip : mergedValues.zip,
  };

  await prisma.$transaction(async (tx) => {
    await tx.wholesaleAccount.update({
      where: { id },
      data: {
        licenseeId,
        isActive: true,
        officialAccountId: state !== 'OH' ? null : officialAccount?.id ?? (licenseeIdsChanged ? null : existingAccount.officialAccountId),
        name: accountValues.name,
        agencyId: accountValues.agencyId,
        ownership: accountValues.ownership,
        address: accountValues.address,
        city: accountValues.city,
        county: accountValues.county,
        state: accountValues.state,
        zip: accountValues.zip,
        districtId: accountValues.districtId,
        deliveryDay: accountValues.deliveryDay,
        phone: accountValues.phone,
        ...addressProtection,
        ...getGeocodeResetForAddressChange(existingValues, accountValues),
      },
    });
    await syncWholesaleAccountLicenseeIds(tx, id, licenseeIds);
  });
  await prisma.wholesaleAccountAssessment.updateMany({ where: { wholesaleAccountId: id }, data: { refreshRequestedAt: new Date() } });
  after(async () => { try { await refreshTenantOpportunityScoresForAccounts({ accountIds: [id] }); } catch { console.warn('Account change assessment refresh remains pending', { accountId: id }); } });

  revalidatePath('/admin/account-research');
  revalidatePath('/wholesale');
  revalidatePath(`/wholesale/${id}`);
  revalidatePath('/visits/new');
  revalidatePath('/alerts');
  revalidatePath('/my-week');
  return { success: `${accountValues.name} saved.` };
}

export async function updateWholesaleAccount(formData: FormData): Promise<ActionResult> {
  const result = await saveWholesaleAccount(formData);
  if ('error' in result) return result;
  redirect(`/wholesale/${String(formData.get('id')).trim()}?status=updated`);
}
