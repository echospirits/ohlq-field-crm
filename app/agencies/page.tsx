import { AddressLink, PhoneLink } from '../components/AccountContactLinks';
﻿export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireEchoAdmin, requireUser } from '../../lib/auth';
import { AGENCY_CSV_MAX_BYTES, AgencyCsvValidationError, importAgencyCsv } from '../../lib/agencyCsvImport';
import { getDirectionsHref } from '../../lib/crmActionContext';
import { formatEasternDate } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';
import { requireOrganizationContext } from '../../lib/organizations';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { AccountViewNavigation } from '../components/AccountViewNavigation';
import { NearbyAccountsSection } from '../components/NearbyAccountsSection';
import { TagBadges } from '../tags/TagBadges';
import { TargetAccountMarker } from '../components/TargetAccountMarker';
import { AgencyCsvImportPanel } from './AgencyCsvImportPanel';
import { directoryPage } from '../../lib/directoryPagination';
import { DirectoryPagination } from '../components/DirectoryPagination';
import type { Prisma } from '@prisma/client';

export const metadata = buildPageMetadata('Retail');

async function importAgencies(formData: FormData) {
  'use server';

  const user = await requireEchoAdmin();
  const { organizationId } = await requireOrganizationContext(user);
  const file = formData.get('csvFile');
  if (!(file instanceof File) || file.size === 0) {
    redirect('/agencies?status=invalid&error=invalid-file');
  }
  if (file.size > AGENCY_CSV_MAX_BYTES) {
    redirect('/agencies?status=invalid&error=too-large');
  }
  let count: number;
  try {
    count = await importAgencyCsv({ csv: await file.text(), user, organizationId });
  } catch (error) {
    if (error instanceof AgencyCsvValidationError) {
      redirect(`/agencies?status=invalid&error=${error.code}`);
    }
    console.error('Retail CSV import failed', error);
    redirect('/agencies?status=failed');
  }

  revalidatePath('/agencies');
  revalidatePath('/visits/new');
  redirect(`/agencies?status=imported&count=${count}`);
}

export default async function AgenciesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; status?: string; count?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();

  const where: Prisma.AgencyWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
            { primaryContact: { contains: q, mode: 'insensitive' } },
            { primaryContactPhone: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { agencyId: { contains: q, mode: 'insensitive' } },
            { tags: { some: { organizationId, tag: { name: { contains: q, mode: 'insensitive' } } } } },
          ],
        }
      : {};
  const total = await prisma.agency.count({ where });
  const pagination = directoryPage(params.page, total);
  const agencies = await prisma.agency.findMany({
    take: pagination.take, skip: pagination.skip, where,
    include: { tags: { where: { organizationId }, include: { tag: true }, orderBy: { createdAt: 'desc' } } },
    orderBy: [{ name: 'asc' }, { agencyId: 'asc' }, { id: 'asc' }],
  });
  const agencyIds = agencies.map((agency) => agency.id);
  const targetingOverlays = await prisma.organizationAccountOverlay.findMany({ where: { organizationId, accountType: 'AGENCY', externalAccountId: { in: agencyIds }, isTargeting: true }, select: { externalAccountId: true } });
  const targetedIds = new Set(targetingOverlays.map((item) => item.externalAccountId));
  const visitStats =
    agencyIds.length > 0
      ? await prisma.loggedVisit.groupBy({
          by: ['agencyId'],
          where: {
            locationType: 'agency',
            organizationId,
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
          <h1>Retail</h1>
        </div>
      </header>
      <AccountViewNavigation active="agencies" />
      <LiveFilterForm className="filter-form narrow-filter" label="Filter retail accounts">
        <label className="sr-only" htmlFor="retail-search">Search retail accounts</label>
        <input id="retail-search" name="q" type="search" defaultValue={q} placeholder="Name, retail ID, address, or phone" />
        <input name="page" type="hidden" value="1" />
      </LiveFilterForm>
      {!q ? <NearbyAccountsSection type="agency" /> : null}
      <DirectoryPagination path="/agencies" params={params} page={pagination.page} total={total} />

      {agencies.length === 0 ? <p className="notice">No retail accounts match your search in the states enabled for your organization.</p> : null}
      <div className="table-scroll" role="region" aria-label="Retail accounts" tabIndex={0}><table className="responsive-table comparison-table account-directory-table retail-directory-table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Location</th>
            <th scope="col">Contact</th>
            <th scope="col">Visits</th>
            <th scope="col">Tags</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {agencies.map((agency) => {
            const stats = visitStatMap[agency.id] ?? { count: 0, lastVisitAt: null };
            const address = [agency.address, agency.city, agency.state, agency.zip].filter(Boolean).join(', ');
            const directionsHref = getDirectionsHref(address);
            const phone = agency.primaryContactPhone ?? agency.phone;

            return (
              <tr className="account-directory-row" key={agency.id}>
                <td className="account-directory-name-cell" data-label="Name">
                  <Link className="table-link account-directory-name-link" href={`/agencies/${agency.id}`}>
                    {agency.name}
                  </Link>
                  {targetedIds.has(agency.id) ? <TargetAccountMarker /> : null}
                  <small className="directory-record-id">Retail {agency.agencyId}</small>
                </td>
                <td className="account-directory-secondary-cell directory-location-cell" data-label="Location"><AddressLink address={address}>{[agency.address, agency.city, agency.state].filter(Boolean).join(', ') || 'Location unavailable'}</AddressLink></td>
                <td className="account-directory-secondary-cell" data-label="Contact"><span>{agency.primaryContact || 'No primary contact'}</span>{phone ? <PhoneLink phone={phone} /> : null}{agency.primaryContactPhone && agency.phone && agency.primaryContactPhone !== agency.phone ? <small>Retail: <PhoneLink phone={agency.phone} /></small> : null}</td>
                <td className="account-directory-secondary-cell" data-label="Visits"><span>{stats.lastVisitAt ? formatEasternDate(stats.lastVisitAt) : 'No recorded visit'}</span><small>{stats.count} logged</small></td>
                <td className="account-directory-secondary-cell" data-label="Tags">
                  <TagBadges tags={agency.tags.map((assignment) => assignment.tag)} />
                </td>
                <td className="account-directory-actions-cell" data-label="Actions">
                  <Link className="btn compact-btn" href={`/visits/new?type=agency&agencyId=${agency.id}`}>
                    Log visit
                  </Link>
                  {directionsHref ? <a aria-label={`Directions to ${agency.name}`} className="btn secondary compact-btn" href={directionsHref} rel="noreferrer" target="_blank">Directions</a> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {pagination.pages > 1 ? <DirectoryPagination path="/agencies" params={params} page={pagination.page} total={total} /> : null}
      <AgencyCsvImportPanel role={user.role} action={importAgencies} status={params.status} error={params.error} count={params.count} />
    </>
  );
}
