export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Papa from 'papaparse';
import { prisma } from '../../lib/prisma';
import type { AccountType, Prisma } from '@prisma/client';

const TYPE_OPTIONS: { label: string; value: AccountType }[] = [
  { label: 'Wholesale (Bar / Restaurant)', value: 'BAR_RESTAURANT' },
  { label: 'Retail (Liquor Agency)', value: 'LIQUOR_AGENCY' },
];

type CsvRow = Record<string, string | undefined>;

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toOptional(value: string | undefined) {
  const normalized = (value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function parseBool(value: string | undefined) {
  const normalized = (value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(normalized);
}

async function createAccount(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '').trim();
  const type = String(formData.get('type') ?? '').trim() as AccountType;

  if (!name || !TYPE_OPTIONS.some((option) => option.value === type)) redirect('/accounts?status=invalid');

  await prisma.account.create({ data: { name, type } });
  revalidatePath('/accounts');
  redirect('/accounts?status=created');
}

async function importAccounts(formData: FormData) {
  'use server';
  const file = formData.get('csvFile');

  if (!(file instanceof File) || file.size === 0) redirect('/accounts?status=import-invalid');

  const text = await file.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: normalizeHeader });
  const rows = parsed.data as CsvRow[];

  if (!rows.length) redirect('/accounts?status=import-empty');

  const first = rows[0];
  const isAgencyFile = 'agencyid' in first && 'dba' in first && 'agencyphone' in first;
  const isAccountFile = 'licenseeid' in first && 'agencyid' in first && 'dba' in first;

  if (!isAgencyFile && !isAccountFile) redirect('/accounts?status=import-unknown');

  let upserts = 0;

  if (isAgencyFile) {
    for (const row of rows) {
      const agencyId = toOptional(row.agencyid);
      if (!agencyId) continue;

      const createData: Prisma.AccountCreateInput = {
        agencyId,
        type: 'LIQUOR_AGENCY',
        name: toOptional(row.dba) ?? `Agency ${agencyId}`,
        address: toOptional(row.address),
        city: toOptional(row.city),
        county: toOptional(row.county),
        zip: toOptional(row.zip),
        phone: toOptional(row.agencyphone),
        d8Permit: parseBool(row.d8permit),
        ownership: null,
        districtId: null,
        warehouse: toOptional(row.warehouse),
        orderDay: toOptional(row.orderday),
        orderWeek: toOptional(row.week),
        deliveryDay: toOptional(row.deliveryday),
        primaryContact: toOptional(row.primarycontact),
        primaryContactPhone: toOptional(row.primarycontactphone),
        wholesaleStatus: toOptional(row.wholesale),
      };

      const updateData: Prisma.AccountUpdateInput = {
        name: createData.name,
        address: createData.address,
        city: createData.city,
        county: createData.county,
        zip: createData.zip,
        phone: createData.phone,
        d8Permit: createData.d8Permit,
        warehouse: createData.warehouse,
        orderDay: createData.orderDay,
        orderWeek: createData.orderWeek,
        deliveryDay: createData.deliveryDay,
        primaryContact: createData.primaryContact,
        primaryContactPhone: createData.primaryContactPhone,
        wholesaleStatus: createData.wholesaleStatus,
        type: 'LIQUOR_AGENCY',
      };

      await prisma.account.upsert({ where: { agencyId }, create: createData, update: updateData });
      upserts += 1;
    }
  }

  if (isAccountFile) {
    for (const row of rows) {
      const licenseeId = toOptional(row.licenseeid);
      if (!licenseeId) continue;

      const createData: Prisma.AccountCreateInput = {
        licenseeId,
        agencyId: toOptional(row.agencyid),
        type: 'BAR_RESTAURANT',
        name: toOptional(row.dba) ?? `Licensee ${licenseeId}`,
        address: toOptional(row.address),
        city: toOptional(row.city),
        county: toOptional(row.county),
        zip: toOptional(row.zipcode),
        phone: toOptional(row.phonenumber),
        ownership: toOptional(row.ownership),
        districtId: toOptional(row.districtid),
        deliveryDay: toOptional(row.deliveryday),
      };

      const updateData: Prisma.AccountUpdateInput = {
        agencyId: createData.agencyId,
        name: createData.name,
        address: createData.address,
        city: createData.city,
        county: createData.county,
        zip: createData.zip,
        phone: createData.phone,
        ownership: createData.ownership,
        districtId: createData.districtId,
        deliveryDay: createData.deliveryDay,
        type: 'BAR_RESTAURANT',
      };

      await prisma.account.upsert({ where: { licenseeId }, create: createData, update: updateData });
      upserts += 1;
    }
  }

  if (upserts === 0) redirect('/accounts?status=import-empty');

  revalidatePath('/accounts');
  redirect(`/accounts?status=imported&count=${upserts}`);
}

export default async function Accounts({ searchParams }: { searchParams?: Promise<{ status?: string; count?: string }> }) {
  const params = (await searchParams) ?? {};
  const accounts = await prisma.account.findMany({
    take: 100,
    orderBy: { name: 'asc' },
    include: { tags: { include: { tag: true } }, salesFacts: { take: 3, orderBy: { periodMonth: 'desc' } } },
  });

  return <>
    <h1>Accounts</h1>
    <p className="muted">Import full liquor agency and account files; matching records are upserted by primary key.</p>
    {params.status === 'created' ? <p className="pill">Account created.</p> : null}
    {params.status === 'imported' ? <p className="pill">Imported/updated {params.count ?? '0'} accounts.</p> : null}
    {params.status === 'invalid' ? <p className="pill">Name and valid account type are required.</p> : null}
    {params.status === 'import-invalid' ? <p className="pill">Choose a CSV file before importing.</p> : null}
    {params.status === 'import-empty' ? <p className="pill">No valid import rows found.</p> : null}
    {params.status === 'import-unknown' ? <p className="pill">CSV headers not recognized for agencies or accounts file.</p> : null}

    <div className="grid" style={{ marginBottom: 18 }}>
      <div className="card">
        <h2>Create account manually</h2>
        <form action={createAccount}>
          <label htmlFor="name">Account name</label><input id="name" name="name" required />
          <label htmlFor="type">Account type</label>
          <select id="type" name="type" required>{TYPE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
          <button type="submit">Create account</button>
        </form>
      </div>
      <div className="card">
        <h2>Import agencies/accounts CSV</h2>
        <p className="muted">Supports both files. Full-file import updates existing rows by AgencyID or LicenseeID.</p>
        <form action={importAccounts}>
          <label htmlFor="csvFile">CSV file</label>
          <input id="csvFile" name="csvFile" type="file" accept=".csv,text/csv" required />
          <button type="submit">Upload and import</button>
        </form>
      </div>
    </div>

    <table><thead><tr><th>Name</th><th>Type</th><th>City</th><th>Agency ID</th><th>Licensee ID</th><th>Tags</th><th>Recent bottles</th></tr></thead><tbody>{accounts.map((a) => <tr key={a.id}><td>{a.name}</td><td>{a.type}</td><td>{a.city}</td><td>{a.agencyId}</td><td>{a.licenseeId}</td><td>{a.tags.map((t) => <span className="pill" key={t.tagId}>{t.tag.name}</span>)}</td><td>{a.salesFacts.reduce((s, f) => s + f.retailBottles + f.wholesaleBottles, 0)}</td></tr>)}</tbody></table>
  </>;
}