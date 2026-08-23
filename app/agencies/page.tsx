export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Papa from 'papaparse';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireUser } from '../../lib/auth';
import { formatEasternDate } from '../../lib/dateTime';
import { getGeocodeResetForAddressChange } from '../../lib/location/geocode';
import { prisma } from '../../lib/prisma';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { AccountViewNavigation } from '../components/AccountViewNavigation';
import { NearbyAccountsSection } from '../components/NearbyAccountsSection';
import { TagBadges } from '../tags/TagBadges';

export const metadata = buildPageMetadata('Agencies');

type CsvRow = Record<string, string | undefined>;

const toOptional = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBool = (value: string | undefined) =>
  ['1', 'true', 'yes', 'y'].includes((value ?? '').trim().toLowerCase());

async function importAgencies(formData: FormData) {
  'use server';

  const user = await requireUser();
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
    const addressValues = {
      address: toOptional(row.address),
      city: toOptional(row.city),
      state: 'OH',
      zip: toOptional(row.zip),
    };
    const existingAgency = await prisma.agency.findUnique({
      where: { agencyId },
      select: { address: true, city: true, state: true, zip: true },
    });

    const agency = await prisma.agency.upsert({
      where: { agencyId },
      create: {
        agencyId,
        name,
        address: addressValues.address,
        city: addressValues.city,
        county: toOptional(row.county),
        zip: addressValues.zip,
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
        address: addressValues.address,
        city: addressValues.city,
        county: toOptional(row.county),
        zip: addressValues.zip,
        phone: toOptional(row.agencyphone),
        d8Permit: parseBool(row.d8permit),
        warehouse: toOptional(row.warehouse),
        orderDay: toOptional(row.orderday),
        orderWeek: toOptional(row.week),
        deliveryDay: toOptional(row.deliveryday),
        primaryContact,
        primaryContactPhone,
        wholesaleStatus: toOptional(row.wholesale),
        ...getGeocodeResetForAddressChange(existingAgency, addressValues),
      },
    });

    await prisma.locationContact.upsert({
      where: { id: `agency-${agencyId}-default` },
      create: {
        id: `agency-${agencyId}-default`,
        agencyId: agency.id,
        name: primaryContact ?? `Agency Contact ${agencyId}`,
        phone: primaryContactPhone,
        role: 'Primary Contact',
        createdByUserId: user.id,
      },
      update: {
        agencyId: agency.id,
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
  await requireUser();

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();

  const agencies = await prisma.agency.findMany({
    take: 250,
    include: {
      tags: {
        include: { tag: true },
        orderBy: { createdAt: 'desc' },
      },
    },
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
            { primaryContact: { contains: q, mode: 'insensitive' } },
            { primaryContactPhone: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { agencyId: { contains: q, mode: 'insensitive' } },
            { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } },
          ],
        }
      : undefined,
    orderBy: [{ name: 'asc' }, { agencyId: 'asc' }],
  });
  const agencyIds = agencies.map((agency) => agency.id);
  const visitStats =
    agencyIds.length > 0
      ? await prisma.loggedVisit.groupBy({
          by: ['agencyId'],
          where: {
            locationType: 'agency',
            agencyId: { in: agencyIds },
          },
          _count: { _all: true },
          _max: { visitAt: true },
        })
      : [];
  const visitStatMap = Object.fromEntries(
    visitStats.map((stat) => [
      stat.agencyId ?? '',
      {
        count: stat._count._all,
        lastVisitAt: stat._max.visitAt,
      },
    ]),
  );

  return (
    <>
      <header className="page-heading page-header">
        <div>
          <span className="page-eyebrow">Accounts</span>
          <h1>Liquor Agencies</h1>
          <p className="muted">Find retail agencies, review account context, and start a visit.</p>
        </div>
      </header>
      <AccountViewNavigation active="agencies" />
      {!q ? <NearbyAccountsSection type="agency" /> : null}
      <LiveFilterForm className="filter-form narrow-filter" label="Filter agencies">
        <input name="q" defaultValue={q} placeholder="Filter name, agency ID, address, contact, phone" />
      </LiveFilterForm>
      {params.status === 'imported' ? <p className="pill">Imported/updated {params.count} agencies.</p> : null}

      <details className="card compact-details admin-panel desktop-admin-panel">
        <summary>Import Agencies CSV</summary>
        <form action={importAgencies}>
          <input type="file" name="csvFile" accept=".csv,text/csv" required />
          <button type="submit">Upload agencies</button>
        </form>
      </details>

      <div className="table-scroll"><table className="responsive-table">
        <thead>
          <tr>
            <th>Actions</th>
            <th>Agency ID</th>
            <th>Name</th>
            <th>Address</th>
            <th>City</th>
            <th>Primary Contact</th>
            <th>Contact Phone</th>
            <th>Agency Phone</th>
            <th>Tags</th>
            <th>Logged Visits</th>
            <th>Most Recent Visit</th>
          </tr>
        </thead>
        <tbody>
          {agencies.map((agency) => {
            const stats = visitStatMap[agency.id] ?? { count: 0, lastVisitAt: null };

            return (
              <tr key={agency.id}>
                <td data-label="Actions">
                  <Link className="btn compact-btn" href={`/visits/new?type=agency&agencyId=${agency.id}`}>
                    Log visit
                  </Link>
                </td>
                <td data-label="Agency ID">{agency.agencyId}</td>
                <td data-label="Name">
                  <Link className="table-link" href={`/agencies/${agency.id}`}>
                    {agency.name}
                  </Link>
                </td>
                <td data-label="Address">{agency.address}</td>
                <td data-label="City">{agency.city}</td>
                <td data-label="Primary Contact">{agency.primaryContact}</td>
                <td data-label="Contact Phone">{agency.primaryContactPhone}</td>
                <td data-label="Agency Phone">{agency.phone}</td>
                <td data-label="Tags">
                  <TagBadges tags={agency.tags.map((assignment) => assignment.tag)} />
                </td>
                <td data-label="Logged Visits">{stats.count}</td>
                <td data-label="Most Recent Visit">{formatEasternDate(stats.lastVisitAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </>
  );
}
