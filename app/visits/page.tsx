export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getUserDisplayName, requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { VisitPhotoGallery } from './VisitPhotoGallery';

export default async function VisitsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; type?: string; status?: string }>;
}) {
  await requireUser();

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();
  const type = (params.type ?? '').trim();

  const visits = await prisma.loggedVisit.findMany({
    take: 300,
    where: {
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
      _count: {
        select: {
          photos: true,
          worklistItems: true,
        },
      },
    },
    orderBy: [{ visitAt: 'desc' }],
  });

  const agencies = await prisma.agency.findMany({
    where: { id: { in: visits.map((visit) => visit.agencyId).filter(Boolean) as string[] } },
  });
  const wholesale = await prisma.wholesaleAccount.findMany({
    where: { id: { in: visits.map((visit) => visit.wholesaleAccountId).filter(Boolean) as string[] } },
  });
  const contacts = await prisma.locationContact.findMany({
    where: { id: { in: visits.map((visit) => visit.contactId).filter(Boolean) as string[] } },
  });

  const agencyMap = Object.fromEntries(agencies.map((agency) => [agency.id, agency.name]));
  const wholesaleMap = Object.fromEntries(wholesale.map((account) => [account.id, account.name]));
  const contactMap = Object.fromEntries(contacts.map((contact) => [contact.id, contact.name]));

  return (
    <>
      <h1>Visits</h1>
      {params.status === 'logged' ? <p className="pill">Visit logged.</p> : null}

      <LiveFilterForm className="card filter-form visit-filter" label="Filter visits">
        <input name="q" defaultValue={q} placeholder="Filter summary, outcomes, next steps, rep" />
        <select name="type" defaultValue={type}>
          <option value="">All types</option>
          <option value="agency">Agency</option>
          <option value="wholesale">Wholesale</option>
        </select>
      </LiveFilterForm>

      <table className="responsive-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Location</th>
            <th>Contact</th>
            <th>Summary</th>
            <th>Outcomes</th>
            <th>Next Step</th>
            <th>Follow-up</th>
            <th>Created By</th>
            <th>Photos</th>
          </tr>
        </thead>
        <tbody>
          {visits.map((visit) => (
            <tr key={visit.id}>
              <td data-label="Date">{new Date(visit.visitAt).toLocaleString()}</td>
              <td data-label="Type">{visit.locationType}</td>
              <td data-label="Location">{visit.locationType === 'agency' ? agencyMap[visit.agencyId ?? ''] : wholesaleMap[visit.wholesaleAccountId ?? '']}</td>
              <td data-label="Contact">{contactMap[visit.contactId ?? '']}</td>
              <td data-label="Summary">{visit.summary}</td>
              <td data-label="Outcomes">{visit.outcomes}</td>
              <td data-label="Next Step">{visit.nextStep}</td>
              <td data-label="Follow-up">{visit.followUpDate ? new Date(visit.followUpDate).toLocaleDateString() : ''}</td>
              <td data-label="Created By">{visit.createdByUser ? getUserDisplayName(visit.createdByUser) : visit.createdBy}</td>
              <td data-label="Photos"><VisitPhotoGallery photos={visit.photos} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
