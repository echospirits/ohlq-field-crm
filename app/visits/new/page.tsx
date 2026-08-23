export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { UserRole, WorklistStatus } from '@prisma/client';
import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { PageHeader } from '../../components/PageChrome';
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
import { TasterVisitForm } from '../TasterVisitForm';

const statusMessages: Record<string, string> = {
  'invalid-agency': 'Select an agency before logging an agency visit.',
  'invalid-wholesale': 'Select an existing wholesale account or create one before logging a wholesale visit.',
  'invalid-contact': 'Select a contact tied to the selected account.',
  'invalid-photo': 'Photos must be image files.',
  'photo-too-large': 'Each uploaded photo must be 5 MB or smaller.',
  'storage-not-configured': 'Photo object storage is not configured yet.',
  'photo-upload-failed': 'The picture could not be uploaded, so the visit was not saved. Try again.',
  'photo-verification-failed': 'The picture could not be verified, so the visit was not saved. Try uploading it again.',
  'comments-required': 'Enter comments before logging the visit.',
  'photo-required': 'Add one picture before logging the visit.',
  'invalid-assignee': 'Choose an active CRM user for the follow-up.',
  'invalid-context': 'The originating task or opportunity no longer matches this account. Start the action again from its source.',
  'visit-logged': 'Agency visit logged.',
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
    opportunityId?: string;
    agencyProductIntelligenceId?: string;
    worklistItemId?: string;
    productItemCode?: string;
    productName?: string;
    sourceType?: string;
    sourceLabel?: string;
    reason?: string;
    returnTo?: string;
  }>;
}) {
  const [params, user] = await Promise.all([(await searchParams) ?? {}, requireUser({ allowTaster: true })]);

  if (user.role === UserRole.TASTER) {
    const agencies = await getAgenciesForVisitPicker({ take: 8 });

    return (
      <>
        <PageHeader
          description="Find a nearby store, review its Echo inventory and recent sales, then log your visit."
          eyebrow="Field activity"
          title="Log Agency Visit"
        />
        {params.status ? <p className="toast-notice page-status">{statusMessages[params.status] ?? params.status}</p> : null}

        <div className="workflow-shell"><div className="card">
          <TasterVisitForm action={createVisit} agencies={agencies} />
        </div></div>
      </>
    );
  }

  const [agencyOptions, wholesaleAccountOptions, contacts, tags, activeUsers, assignedWorklistItems] = await Promise.all([
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
    prisma.user.findMany({
      where: { isActive: true, role: { not: UserRole.TASTER } },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, firstName: true, lastName: true, name: true },
    }),
    prisma.worklistItem.findMany({
      where: {
        assignedToUserId: user.id,
        status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] },
        OR: [{ agencyId: { not: null } }, { wholesaleAccountId: { not: null } }],
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      select: { agencyId: true, id: true, title: true, wholesaleAccountId: true },
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
      <PageHeader
        description="Pick the account, tap what happened, and save. Add detail only when it helps."
        eyebrow="Field activity"
        title="Log Visit"
      />
      {params.status ? <p className="toast-notice page-status">{statusMessages[params.status] ?? params.status}</p> : null}

      <div className="workflow-shell"><div className="card">
        <LogVisitForm
          action={createVisit}
          actorName={getUserDisplayName(user)}
          currentUserId={user.id}
          agencies={agencies}
          assignedWorklistItems={assignedWorklistItems}
          contacts={contacts}
          initialValues={{
            locationType: initialLocationType,
            agencyId: params.agencyId ?? null,
            locationLocked: Boolean(params.agencyId || params.wholesaleAccountId),
            startVoiceNote: params.voice === '1',
            wholesaleAccountId: params.wholesaleAccountId ?? null,
            opportunityId: params.opportunityId ?? null,
            agencyProductIntelligenceId: params.agencyProductIntelligenceId ?? null,
            productItemCode: params.productItemCode ?? null,
            productName: params.productName ?? null,
            sourceType: params.sourceType ?? null,
            sourceLabel: params.sourceLabel ?? null,
            reason: params.reason ?? null,
            returnTo: params.returnTo?.startsWith('/') && !params.returnTo.startsWith('//') ? params.returnTo : null,
          }}
          tags={tags}
          users={activeUsers.map((activeUser) => ({ id: activeUser.id, name: getUserDisplayName(activeUser) }))}
          wholesaleAccounts={wholesaleAccounts}
          worklistItemId={params.worklistItemId}
        />
      </div></div>
    </>
  );
}
