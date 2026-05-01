export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';

const toOptional = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

async function createWholesale(formData: FormData) {
  'use server';

  const user = await requireUser();
  const licenseeId = String(formData.get('licenseeId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();

  if (!licenseeId || !name) {
    redirect('/wholesale?status=invalid');
  }

  await prisma.wholesaleAccount.upsert({
    where: { licenseeId },
    create: {
      licenseeId,
      name,
      agencyId: toOptional(String(formData.get('agencyId') ?? '')),
      address: toOptional(String(formData.get('address') ?? '')),
      city: toOptional(String(formData.get('city') ?? '')),
      county: toOptional(String(formData.get('county') ?? '')),
      zip: toOptional(String(formData.get('zip') ?? '')),
      phone: toOptional(String(formData.get('phone') ?? '')),
      ownership: toOptional(String(formData.get('ownership') ?? '')),
      districtId: toOptional(String(formData.get('districtId') ?? '')),
      deliveryDay: toOptional(String(formData.get('deliveryDay') ?? '')),
      createdByUserId: user.id,
    },
    update: {
      name,
      agencyId: toOptional(String(formData.get('agencyId') ?? '')),
      address: toOptional(String(formData.get('address') ?? '')),
      city: toOptional(String(formData.get('city') ?? '')),
      county: toOptional(String(formData.get('county') ?? '')),
      zip: toOptional(String(formData.get('zip') ?? '')),
      phone: toOptional(String(formData.get('phone') ?? '')),
      ownership: toOptional(String(formData.get('ownership') ?? '')),
      districtId: toOptional(String(formData.get('districtId') ?? '')),
      deliveryDay: toOptional(String(formData.get('deliveryDay') ?? '')),
    },
  });

  revalidatePath('/wholesale');
  revalidatePath('/visits/new');
  redirect('/wholesale?status=saved');
}

export default async function WholesalePage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string }>;
}) {
  await requireUser();

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();

  const accounts = await prisma.wholesaleAccount.findMany({
    take: 300,
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { licenseeId: { contains: q, mode: 'insensitive' } },
            { agencyId: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: [{ name: 'asc' }, { licenseeId: 'asc' }],
  });

  return (
    <>
      <h1>Wholesale Accounts</h1>
      <p className="muted">Manual creation only.</p>

      <div className="grid">
        <div className="card">
          <h2>Create / update wholesale account</h2>
          <form action={createWholesale}>
            <input name="licenseeId" placeholder="Licensee ID" required />
            <input name="name" placeholder="Name" required />
            <input name="agencyId" placeholder="Agency ID" />
            <input name="address" placeholder="Address" />
            <input name="city" placeholder="City" />
            <input name="county" placeholder="County" />
            <input name="zip" placeholder="Zip" />
            <input name="phone" placeholder="Phone" />
            <input name="ownership" placeholder="Ownership" />
            <input name="districtId" placeholder="District ID" />
            <input name="deliveryDay" placeholder="Delivery Day" />
            <button type="submit">Save wholesale account</button>
          </form>
        </div>
      </div>

      <form method="get" className="filter-form narrow-filter">
        <input name="q" defaultValue={q} placeholder="Filter name, licensee ID, agency ID, address, phone" />
      </form>
      {params.status === 'saved' ? <p className="pill">Wholesale account saved.</p> : null}
      {params.status === 'invalid' ? <p className="pill">Name and Licensee ID are required.</p> : null}

      <table className="responsive-table">
        <thead>
          <tr>
            <th>Licensee ID</th>
            <th>Name</th>
            <th>Agency ID</th>
            <th>Address</th>
            <th>City</th>
            <th>Phone</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td data-label="Licensee ID">{account.licenseeId}</td>
              <td data-label="Name">{account.name}</td>
              <td data-label="Agency ID">{account.agencyId}</td>
              <td data-label="Address">{account.address}</td>
              <td data-label="City">{account.city}</td>
              <td data-label="Phone">{account.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
