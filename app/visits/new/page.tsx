export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { createVisit } from '../actions';
import { LogVisitForm } from '../LogVisitForm';

const statusMessages: Record<string, string> = {
  'invalid-agency': 'Select an agency before logging an agency visit.',
  'invalid-wholesale': 'Select an existing wholesale account or create one before logging a wholesale visit.',
  'invalid-contact': 'Select a contact tied to the selected account.',
  'invalid-photo': 'Photos must be image files.',
  'photo-too-large': 'Each uploaded photo must be 5 MB or smaller.',
  'storage-not-configured': 'Photo object storage is not configured yet.',
  'photo-upload-failed': 'The visit was saved, but one or more photos could not be uploaded.',
};

export default async function NewVisitPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const [params, user, agencies, wholesaleAccounts, contacts, tags] = await Promise.all([
    (await searchParams) ?? {},
    requireUser(),
    prisma.agency.findMany({
      orderBy: { name: 'asc' },
      take: 500,
      select: {
        id: true,
        agencyId: true,
        name: true,
        city: true,
        county: true,
        phone: true,
      },
    }),
    prisma.wholesaleAccount.findMany({
      orderBy: { name: 'asc' },
      take: 500,
      select: {
        id: true,
        licenseeId: true,
        name: true,
        agencyId: true,
        city: true,
        county: true,
        phone: true,
      },
    }),
    prisma.locationContact.findMany({
      orderBy: { name: 'asc' },
      take: 1000,
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        email: true,
        agencyId: true,
        wholesaleAccountId: true,
      },
    }),
    prisma.tag.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
      },
    }),
  ]);

  return (
    <>
      <h1>Log Visit</h1>
      {params.status ? <p className="pill">{statusMessages[params.status] ?? params.status}</p> : null}

      <div className="card">
        <LogVisitForm
          action={createVisit}
          actorName={getUserDisplayName(user)}
          agencies={agencies}
          contacts={contacts}
          tags={tags}
          wholesaleAccounts={wholesaleAccounts}
        />
      </div>
    </>
  );
}
