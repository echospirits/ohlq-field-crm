export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import {
  getAgenciesForVisitPicker,
  getAgencyVisitPickerOptionById,
  getInitialVisitLocationType,
  getWholesaleAccountsForVisitPicker,
  getWholesaleVisitPickerOptionById,
  sortVisitPickerOptions,
} from '../../../lib/visitPickerOptions';
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
  searchParams?: Promise<{
    status?: string;
    type?: string;
    agencyId?: string;
    wholesaleAccountId?: string;
    voice?: string;
  }>;
}) {
  const [params, user, agencyOptions, wholesaleAccountOptions, contacts, tags] = await Promise.all([
    (await searchParams) ?? {},
    requireUser(),
    getAgenciesForVisitPicker(),
    getWholesaleAccountsForVisitPicker(),
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
  const initialLocationType = getInitialVisitLocationType(params);
  const [selectedAgency, selectedWholesaleAccount] = await Promise.all([
    params.agencyId && !agencyOptions.some((agency) => agency.id === params.agencyId)
      ? getAgencyVisitPickerOptionById({ id: params.agencyId })
      : null,
    params.wholesaleAccountId &&
        !wholesaleAccountOptions.some((account) => account.id === params.wholesaleAccountId)
      ? getWholesaleVisitPickerOptionById({ id: params.wholesaleAccountId })
      : null,
  ]);
  const agencies = sortVisitPickerOptions(
    selectedAgency && !agencyOptions.some((agency) => agency.id === selectedAgency.id)
      ? [selectedAgency, ...agencyOptions]
      : agencyOptions,
  );
  const wholesaleAccounts = sortVisitPickerOptions(
    selectedWholesaleAccount && !wholesaleAccountOptions.some((account) => account.id === selectedWholesaleAccount.id)
      ? [selectedWholesaleAccount, ...wholesaleAccountOptions]
      : wholesaleAccountOptions,
  );

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
          initialValues={{
            locationType: initialLocationType,
            agencyId: params.agencyId ?? null,
            startVoiceNote: params.voice === '1',
            wholesaleAccountId: params.wholesaleAccountId ?? null,
          }}
          tags={tags}
          wholesaleAccounts={wholesaleAccounts}
        />
      </div>
    </>
  );
}
