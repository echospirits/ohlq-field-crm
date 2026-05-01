export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Papa from 'papaparse';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/prisma';

type CsvRow = Record<string, string | undefined>;

const toOptional = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBool = (value: string | undefined) =>
  ['1', 'true', 'yes', 'y'].includes((value ?? '').trim().toLowerCase());

async function importAgencies(formData: FormData) {
  'use server';

  const file = formData.get('csvFile');
  if (!(file instanceof File) || file.size === 0) {
    redirect('/agencies?status=invalid');
  }

  const parsed = Papa.parse(await file.text(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, ''),
  });

  let count = 0;
  for (const row of parsed.data as CsvRow[]) {
    const agencyId = toOptional(row.agencyid);
    if (!agencyId) continue;

    const name = toOptional(row.dba) ?? `Agency ${agencyId}`;
    const primaryContact = toOptional(row.primarycontact);
    const primaryContactPhone = toOptional(row.primarycontactphone);

    await prisma.agency.upsert({
      where: { agencyId },
      create: {
        agencyId,
        name,
        address: toOptional(row.address),
        city: toOptional(row.city),
        county: toOptional(row.county),
        zip: toOptional(row.zip),
        phone: toOptional(row.agencyphone),
        d8Permit: parseBool(row.d8permit),
        warehouse: toOptional(row.warehouse),
        orderDay: toOptional(row.orderday),
        orderWeek: toOptional(row.week),
        deliveryDay: toOptional(row.deliveryday),
        primaryContact,
        primaryContactPhone,
        wholesaleStatus: toOptional(row.wholesale),
      },
      update: {
        name,
        address: toOptional(row.address),
        city: toOptional(row.city),
        county: toOptional(row.county),
        zip: toOptional(row.zip),
        phone: toOptional(row.agencyphone),
        d8Permit: parseBool(row.d8permit),
        warehouse: toOptional(row.warehouse),
        orderDay: toOptional(row.orderday),
        orderWeek: toOptional(row.week),
        deliveryDay: toOptional(row.deliveryday),
        primaryContact,
        primaryContactPhone,
        wholesaleStatus: toOptional(row.wholesale),
      },
    });

    await prisma.locationContact.upsert({
      where: { id: `agency-${agencyId}-default` },
      create: {
        id: `agency-${agencyId}-default`,
        agencyId,
        name: primaryContact ?? `Agency Contact ${agencyId}`,
        phone: primaryContactPhone,
        role: 'Primary Contact',
      },
      update: {
        name: primaryContact ?? `Agency Contact ${agencyId}`,
        phone: primaryContactPhone,
        role: 'Primary Contact',
      },
    });

    count += 1;
  }

  revalidatePath('/agencies');
  revalidatePath('/visits/new');
  redirect(`/agencies?status=imported&count=${count}`);
}

export default async function AgenciesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string; count?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();

  const agencies = await prisma.agency.findMany({
    take: 250,
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
            { primaryContact: { contains: q, mode: 'insensitive' } },
            { primaryContactPhone: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { agencyId: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: [{ name: 'asc' }, { agencyId: 'asc' }],
  });

  return (
    <>
      <h1>Liquor Agencies</h1>
      <form method="get" style={{ maxWidth: 520 }}>
        <input name="q" defaultValue={q} placeholder="Filter name, agency ID, address, contact, phone" />
      </form>
      {params.status === 'imported' ? <p className="pill">Imported/updated {params.count} agencies.</p> : null}

      <div className="card">
        <h2>Import Agencies CSV</h2>
        <form action={importAgencies}>
          <input type="file" name="csvFile" accept=".csv,text/csv" required />
          <button type="submit">Upload agencies</button>
        </form>
      </div>

      <table>
        <thead>
          <tr>
            <th>Agency ID</th>
            <th>Name</th>
            <th>Address</th>
            <th>City</th>
            <th>Primary Contact</th>
            <th>Contact Phone</th>
            <th>Agency Phone</th>
          </tr>
        </thead>
        <tbody>
          {agencies.map((agency) => (
            <tr key={agency.id}>
              <td>{agency.agencyId}</td>
              <td>{agency.name}</td>
              <td>{agency.address}</td>
              <td>{agency.city}</td>
              <td>{agency.primaryContact}</td>
              <td>{agency.primaryContactPhone}</td>
              <td>{agency.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
