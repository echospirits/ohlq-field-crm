export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { prisma } from '../../lib/prisma';

export default async function VisitsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; type?: string }>;
}) {
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
          ]
        : undefined,
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

      <form method="get" className="card" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, maxWidth: 920 }}>
        <input name="q" defaultValue={q} placeholder="Filter summary, outcomes, next steps, rep" />
        <select name="type" defaultValue={type}>
          <option value="">All types</option>
          <option value="agency">Agency</option>
          <option value="wholesale">Wholesale</option>
        </select>
        <button type="submit">Filter</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Location</th>
            <th>Contact</th>
            <th>Summary</th>
            <th>Outcomes</th>
            <th>Next Step</th>
          </tr>
        </thead>
        <tbody>
          {visits.map((visit) => (
            <tr key={visit.id}>
              <td>{new Date(visit.visitAt).toLocaleString()}</td>
              <td>{visit.locationType}</td>
              <td>{visit.locationType === 'agency' ? agencyMap[visit.agencyId ?? ''] : wholesaleMap[visit.wholesaleAccountId ?? '']}</td>
              <td>{contactMap[visit.contactId ?? '']}</td>
              <td>{visit.summary}</td>
              <td>{visit.outcomes}</td>
              <td>{visit.nextStep}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
