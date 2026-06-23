export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AccountType } from '@prisma/client';
import { requireUser } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import {
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

  for (const lookupLicenseeId of lookupLicenseeIds) {
    const officialAccount = await prisma.account.findFirst({
      where: {
        licenseeId: { equals: lookupLicenseeId, mode: 'insensitive' },
        type: AccountType.BAR_RESTAURANT,
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
    });

    if (officialAccount) {
      return officialAccount;
    }
  }

  return null;
}

async function updateWholesaleAccount(formData: FormData) {
  'use server';

  await requireUser();

  const id = toOptional(formData.get('id'));
  const submittedLicenseeIds = parseWholesaleLicenseeIds(
    String(formData.get('licenseeIds') ?? formData.get('licenseeId') ?? ''),
  );
  const submittedLicenseeId = getPrimaryWholesaleLicenseeId(submittedLicenseeIds);
  const name = toOptional(formData.get('name'));
  const isActive = formData.get('isActive') === 'true';

  if (!id || !submittedLicenseeId || !name) {
    redirect(id ? `/wholesale/${id}/edit?status=invalid` : '/wholesale?status=invalid');
  }

  const existingAccount = await prisma.wholesaleAccount.findUnique({
    where: { id },
    select: {
      address: true,
      agencyId: true,
      city: true,
      county: true,
      deliveryDay: true,
      districtId: true,
      id: true,
      licenseeId: true,
      licenseeIds: { select: { licenseeId: true } },
      name: true,
      officialAccountId: true,
      ownership: true,
      phone: true,
      state: true,
      zip: true,
    },
  });

  if (!existingAccount) {
    notFound();
  }

  const existingLicenseeIds = getWholesaleLicenseeIdValues(existingAccount);
  const licenseeIdsChanged = !wholesaleLicenseeIdListsMatch(existingLicenseeIds, submittedLicenseeIds);
  const officialAccount = licenseeIdsChanged
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
    redirect(`/wholesale/${id}/edit?status=invalid`);
  }

  const accountWithLicenseeId = await prisma.wholesaleAccount.findFirst({
    where: getWholesaleLicenseeIdConflictWhere(licenseeIds, id),
    select: { id: true },
  });

  if (accountWithLicenseeId && accountWithLicenseeId.id !== id) {
    redirect(`/wholesale/${id}/edit?status=duplicate-licensee`);
  }

  const submittedValues: WholesaleAccountEditableValues = {
    address: toOptional(formData.get('address')),
    agencyId: toOptional(formData.get('agencyId')),
    city: toOptional(formData.get('city')),
    county: toOptional(formData.get('county')),
    deliveryDay: toOptional(formData.get('deliveryDay')),
    districtId: toOptional(formData.get('districtId')),
    name,
    ownership: toOptional(formData.get('ownership')),
    phone: toOptional(formData.get('phone')),
    state: toOptional(formData.get('state')) ?? 'OH',
    zip: toOptional(formData.get('zip')),
  };
  const normalizedExistingLicenseeId = normalizeWholesaleLicenseeId(existingAccount.licenseeId);
  const licenseeIdChanged = normalizedExistingLicenseeId !== licenseeId;

  if (officialAccount?.officialWholesale && officialAccount.officialWholesale.id !== id) {
    redirect(`/wholesale/${id}/edit?status=duplicate-official`);
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
  const accountValues =
    officialAccount && licenseeIdsChanged
      ? mergeWholesaleEditableValuesWithOfficialDefaults({
          existingValues,
          officialValues: getWholesaleEditableValuesFromOfficialAccount(officialAccount),
          submittedValues,
        })
      : submittedValues;

  await prisma.$transaction(async (tx) => {
    await tx.wholesaleAccount.update({
      where: { id },
      data: {
        licenseeId,
        isActive,
        officialAccountId: officialAccount?.id ?? (licenseeIdsChanged ? null : existingAccount.officialAccountId),
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
      },
    });
    await syncWholesaleAccountLicenseeIds(tx, id, licenseeIds);
  });

  revalidatePath('/wholesale');
  revalidatePath(`/wholesale/${id}`);
  revalidatePath('/visits/new');
  revalidatePath('/alerts');
  revalidatePath('/my-week');
  redirect(`/wholesale/${id}?status=updated`);
}

const statusMessages: Record<string, string> = {
  invalid: 'Name and at least one Licensee ID are required.',
  'duplicate-licensee': 'Another wholesale account already uses one of those Licensee IDs.',
  'duplicate-official': 'That official account is already linked to another wholesale account.',
};

export default async function EditWholesaleAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const account = await prisma.wholesaleAccount.findUnique({
    where: { id },
    include: {
      licenseeIds: {
        orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }],
        select: { licenseeId: true },
      },
    },
  });

  if (!account) {
    notFound();
  }

  return (
    <>
      <div className="page-actions">
        <Link href={`/wholesale/${account.id}`}>Back to account</Link>
      </div>

      <h1>Edit Wholesale Account</h1>
      <p className="muted">{account.name}</p>
      {query.status ? <p className="pill">{statusMessages[query.status] ?? query.status}</p> : null}

      <div className="card admin-panel">
        <form action={updateWholesaleAccount}>
          <input name="id" type="hidden" value={account.id} />
          <div className="form-grid">
            <label>
              Licensee IDs
              <textarea name="licenseeIds" defaultValue={getWholesaleLicenseeIdValues(account).join('\n')} required rows={3} />
            </label>
            <label>
              Account name
              <input name="name" defaultValue={account.name} required />
            </label>
            <label>
              Status
              <select name="isActive" defaultValue={account.isActive ? 'true' : 'false'}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <label>
              Phone
              <input name="phone" defaultValue={account.phone ?? ''} />
            </label>
            <label>
              Agency ID
              <input name="agencyId" defaultValue={account.agencyId ?? ''} />
            </label>
            <label>
              Address
              <input name="address" defaultValue={account.address ?? ''} />
            </label>
            <label>
              City
              <input name="city" defaultValue={account.city ?? ''} />
            </label>
            <label>
              County
              <input name="county" defaultValue={account.county ?? ''} />
            </label>
            <label>
              State
              <input name="state" defaultValue={account.state ?? 'OH'} />
            </label>
            <label>
              Zip
              <input name="zip" defaultValue={account.zip ?? ''} />
            </label>
            <label>
              Ownership
              <input name="ownership" defaultValue={account.ownership ?? ''} />
            </label>
            <label>
              District ID
              <input name="districtId" defaultValue={account.districtId ?? ''} />
            </label>
            <label>
              Delivery day
              <input name="deliveryDay" defaultValue={account.deliveryDay ?? ''} />
            </label>
          </div>
          <button type="submit">Save wholesale account</button>
        </form>
      </div>
    </>
  );
}
