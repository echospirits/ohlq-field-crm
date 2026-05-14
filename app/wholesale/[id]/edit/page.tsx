export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { normalizeWholesaleLicenseeId } from '../../../../lib/wholesaleAccounts';

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

async function updateWholesaleAccount(formData: FormData) {
  'use server';

  await requireUser();

  const id = toOptional(formData.get('id'));
  const licenseeId = normalizeWholesaleLicenseeId(String(formData.get('licenseeId') ?? ''));
  const name = toOptional(formData.get('name'));
  const isActive = formData.get('isActive') === 'true';

  if (!id || !licenseeId || !name) {
    redirect(id ? `/wholesale/${id}/edit?status=invalid` : '/wholesale?status=invalid');
  }

  const existingAccount = await prisma.wholesaleAccount.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existingAccount) {
    notFound();
  }

  const accountWithLicenseeId = await prisma.wholesaleAccount.findUnique({
    where: { licenseeId },
    select: { id: true },
  });

  if (accountWithLicenseeId && accountWithLicenseeId.id !== id) {
    redirect(`/wholesale/${id}/edit?status=duplicate-licensee`);
  }

  await prisma.wholesaleAccount.update({
    where: { id },
    data: {
      licenseeId,
      isActive,
      name,
      agencyId: toOptional(formData.get('agencyId')),
      ownership: toOptional(formData.get('ownership')),
      address: toOptional(formData.get('address')),
      city: toOptional(formData.get('city')),
      county: toOptional(formData.get('county')),
      state: toOptional(formData.get('state')) ?? 'OH',
      zip: toOptional(formData.get('zip')),
      districtId: toOptional(formData.get('districtId')),
      deliveryDay: toOptional(formData.get('deliveryDay')),
      phone: toOptional(formData.get('phone')),
    },
  });

  revalidatePath('/wholesale');
  revalidatePath(`/wholesale/${id}`);
  revalidatePath('/visits');
  revalidatePath('/alerts');
  revalidatePath('/my-week');
  redirect(`/wholesale/${id}?status=updated`);
}

const statusMessages: Record<string, string> = {
  invalid: 'Name and Licensee ID are required.',
  'duplicate-licensee': 'Another wholesale account already uses that Licensee ID.',
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
              Licensee ID
              <input name="licenseeId" defaultValue={account.licenseeId} required />
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
          <button type="submit">Save changes</button>
        </form>
      </div>
    </>
  );
}
