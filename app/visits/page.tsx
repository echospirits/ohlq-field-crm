export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { requireOrganizationContext } from '../../lib/organizations';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { EmptyState, PageHeader, SectionHeading } from '../components/PageChrome';
import { VisitActivityTable } from './VisitActivityTable';

export const metadata = buildPageMetadata('Visits');

export default async function VisitsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; type?: string; status?: string }>;
}) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();
  const type = (params.type ?? '').trim();

  const visits = await prisma.loggedVisit.findMany({
    take: 300,
    where: {
      organizationId,
      locationType: type || undefined,
      OR: q
        ? [
            { summary: { contains: q, mode: 'insensitive' } },
            { outcomes: { contains: q, mode: 'insensitive' } },
            { nextStep: { contains: q, mode: 'insensitive' } },
            { createdBy: { contains: q, mode: 'insensitive' } },
            { createdByUser: { name: { contains: q, mode: 'insensitive' } } },
            { createdByUser: { email: { contains: q, mode: 'insensitive' } } },
          ]
        : undefined,
    },
    include: {
      createdByUser: true,
      photos: {
        orderBy: { createdAt: 'asc' },
      },
      worklistItems: {
        select: { id: true, status: true, title: true },
      },
      _count: {
        select: {
          photos: true,
          worklistItems: true,
        },
      },
    },
    orderBy: [{ visitAt: 'desc' }],
  });

  const [agencies, wholesale, contacts] = await Promise.all([
    prisma.agency.findMany({
      where: { id: { in: visits.map((visit) => visit.agencyId).filter(Boolean) as string[] } },
    }),
    prisma.wholesaleAccount.findMany({
      where: { id: { in: visits.map((visit) => visit.wholesaleAccountId).filter(Boolean) as string[] } },
    }),
    prisma.locationContact.findMany({
      where: { organizationId, id: { in: visits.map((visit) => visit.contactId).filter(Boolean) as string[] } },
    }),
  ]);

  const agencyMap = Object.fromEntries(agencies.map((agency) => [agency.id, agency.name]));
  const wholesaleMap = Object.fromEntries(wholesale.map((account) => [account.id, account.name]));
  const contactMap = Object.fromEntries(contacts.map((contact) => [contact.id, contact.name]));

  return (
    <>
      <PageHeader
        actions={<Link className="btn" href="/visits/new">Log visit</Link>}
        description="Review field activity, outcomes, follow-ups, and supporting photos across every account."
        eyebrow="Activity"
        title="Visits"
      />
      {params.status === 'logged' ? <p className="toast-notice page-status">Visit logged.</p> : null}
      {params.status === 'updated' ? <p className="toast-notice page-status">Visit updated.</p> : null}

      <LiveFilterForm className="card filter-form visit-filter" label="Filter visits">
        <input name="q" defaultValue={q} placeholder="Filter summary, outcomes, next steps, rep" />
        <select name="type" defaultValue={type}>
          <option value="">All types</option>
          <option value="agency">Agency</option>
          <option value="wholesale">Wholesale</option>
        </select>
      </LiveFilterForm>

      <section className="content-section">
        <SectionHeading
          count={visits.length}
          description={q || type ? 'Filtered to the current search.' : 'Most recent activity, newest first.'}
          title="Visit history"
        />
      {visits.length > 0 ? (
        <VisitActivityTable
          contactMap={contactMap}
          visits={visits.map((visit) => {
            const locationName =
              visit.locationType === 'agency'
                ? agencyMap[visit.agencyId ?? '']
                : wholesaleMap[visit.wholesaleAccountId ?? ''];
            const locationHref =
              visit.locationType === 'agency' && visit.agencyId
                ? `/agencies/${visit.agencyId}`
                : visit.locationType === 'wholesale' && visit.wholesaleAccountId
                  ? `/wholesale/${visit.wholesaleAccountId}`
                  : null;

            return { ...visit, locationName: locationName ?? 'Unknown account', locationHref };
          })}
        />
      ) : (
        <EmptyState
          action={<Link className="btn" href="/visits/new">Log a visit</Link>}
          description="Adjust the filters or capture the first visit for this view."
          title="No visits match"
        />
      )}
      </section>
    </>
  );
}
