import { readVisitGuides } from '../../../lib/crm/visitGuides';
import { randomUUID } from 'node:crypto';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { UserRole, WorklistStatus } from '@prisma/client';
import { buildPageMetadata } from '../../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { PageHeader } from '../../components/PageChrome';
import {
  getAgenciesForVisitPicker,
  getAgencyVisitPickerOptionById,
  getInitialVisitLocationType,
  getVisitPickerSuggestions,
  getWholesaleVisitPickerOptionById,
} from '../../../lib/visitPickerOptions';
import { createVisit } from '../actions';
import { LogVisitForm } from '../LogVisitForm';
import { TasterVisitForm } from '../TasterVisitForm';
import { getOrganizationFeatures, requireOrganizationContext } from '../../../lib/organizations';
import { VISIT_SALES_STATUS_OPTIONS } from '../../../lib/accountSalesStatus';
import { startVisitServerTiming } from '../../../lib/visitTimingServer';
import { VisitFormTiming } from '../VisitTiming';

export const metadata = buildPageMetadata('Log Visit');

const statusMessages: Record<string, string> = {
  'invalid-state': 'Enter a valid US state name or two-letter abbreviation.',
  'conflicting-state': 'That Licensee ID belongs to an account in another state. Leave the ID blank to create a separate account.',
  'invalid-agency': 'Select a retail account before logging a retail account visit.',
  'invalid-wholesale': 'Select an existing restaurant account or create one before logging a restaurant visit.',
  'invalid-contact': 'Select a contact tied to the selected account.',
  'invalid-photo': 'Photos must be image files.',
  'photo-too-large': 'Each uploaded photo must be 5 MB or smaller.',
  'storage-not-configured': 'Photo object storage is not configured yet.',
  'photo-upload-failed': 'The picture could not be uploaded, so the visit was not saved. Try again.',
  'photo-verification-failed': 'The picture could not be verified, so the visit was not saved. Try uploading it again.',
  'comments-required': 'Enter comments before logging the visit.',
  'visit-notes-required': 'Add visit notes before saving.',
  'visit-notes-too-long': 'Visit notes can be up to 4,000 characters.',
  'visit-outcome-required': 'Select at least one outcome before saving.',
  'invalid-sales-status': 'Select a sales status or keep No change.',
  'photo-required': 'Add one picture before logging the visit.',
  'invalid-assignee': 'Choose an active team member for the follow-up.',
  'invalid-context': 'The originating task or opportunity no longer matches this account. Start the action again from its source.',
  'visit-logged': 'Retail visit logged.',
};

export default async function NewVisitPage({
  searchParams,
}: {
  searchParams?: Promise<{
    eventId?: string;
    status?: string;
    type?: string;
    agencyId?: string;
    wholesaleAccountId?: string;
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
  const timingId = randomUUID();
  const timing = startVisitServerTiming(timingId, 'form');
  const [resolvedParams, user] = await Promise.all([searchParams, requireUser({ allowTaster: true })]);
  const params: NonNullable<Awaited<typeof searchParams>> = resolvedParams ?? {};
  const { organizationId, organization } = await requireOrganizationContext(user);
  timing?.mark('authenticated');
  if (user.role === UserRole.TASTER) {
    const agencies = await getAgenciesForVisitPicker({ take: 8, organizationId });

    timing?.mark('loaded');
    timing?.finish('success');
    return (
      <>
        {timing ? <VisitFormTiming id={timingId} /> : null}
        <PageHeader
            title="Log Retail Visit"
        />
        {params.status ? <p className="toast-notice page-status">{statusMessages[params.status] ?? params.status}</p> : null}

        <div className="workflow-shell"><div className="card">
          <TasterVisitForm action={createVisit} agencies={agencies} />
        </div></div>
      </>
    );
  }

  const initialLocationType = getInitialVisitLocationType(params);
  const selectedAgencyId = initialLocationType === 'agency' ? params.agencyId : null;
  const selectedWholesaleAccountId = initialLocationType === 'wholesale' ? params.wholesaleAccountId : null;
  const [suggestions, selectedAgency, selectedWholesaleAccount, tags, activeUsers, assignedWorklistItems, targetingOverlays, enabledFeatures] = await Promise.all([
    selectedAgencyId || selectedWholesaleAccountId ? null : getVisitPickerSuggestions(organizationId),
    selectedAgencyId ? getAgencyVisitPickerOptionById({ id: selectedAgencyId, organizationId }) : null,
    selectedWholesaleAccountId ? getWholesaleVisitPickerOptionById({ id: selectedWholesaleAccountId, organizationId }) : null,
    prisma.tag.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
      },
    }),
    prisma.user.findMany({
      where: { organizationId, isActive: true, role: { not: UserRole.TASTER } },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, firstName: true, lastName: true, name: true },
    }),
    prisma.worklistItem.findMany({
      where: {
        organizationId,
        assignedToUserId: user.id,
        status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] },
        OR: [{ agencyId: { not: null } }, { wholesaleAccountId: { not: null } }],
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      select: { agencyId: true, id: true, title: true, wholesaleAccountId: true },
    }),
    prisma.organizationAccountOverlay.findMany({ where: { organizationId, isTargeting: true }, select: { accountType: true, externalAccountId: true } }),
    getOrganizationFeatures(organizationId),
  ]);
  const agencies = selectedAgency ? [selectedAgency] : suggestions?.agencies ?? [];
  const wholesaleAccounts = selectedWholesaleAccount ? [selectedWholesaleAccount] : suggestions?.wholesaleAccounts ?? [];

  timing?.mark('loaded');
  timing?.finish('success');
  return (
    <>
      {timing ? <VisitFormTiming id={timingId} /> : null}
      <PageHeader
        title="Log Visit"
      />
      {params.status ? <p className="toast-notice page-status">{statusMessages[params.status] ?? params.status}</p> : null}

      <div className="workflow-shell"><div className="card">
        <LogVisitForm organizationId={organizationId} visitGuides={readVisitGuides(organization.crmPreferences)}
          action={createVisit}
          actorName={getUserDisplayName(user)}
          currentUserId={user.id}
          agencies={agencies}
          assignedWorklistItems={assignedWorklistItems}
          contacts={[]}
          loadSelectedAccountContacts
          loadPickerSuggestions={!suggestions}
          initialValues={{
              eventId: params.eventId,
            locationType: initialLocationType,
            agencyId: selectedAgency?.id ?? null,
            locationLocked: Boolean(selectedAgency || selectedWholesaleAccount),
            wholesaleAccountId: selectedWholesaleAccount?.id ?? null,
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
          salesStatusOptions={enabledFeatures.has('ACCOUNT_SALES_STATUS') ? VISIT_SALES_STATUS_OPTIONS.map((option) => ({ ...option })) : []}
          targetedAgencyIds={targetingOverlays.filter((overlay) => overlay.accountType === 'AGENCY').map((overlay) => overlay.externalAccountId)}
          targetedWholesaleAccountIds={targetingOverlays.filter((overlay) => overlay.accountType === 'WHOLESALE').map((overlay) => overlay.externalAccountId)}
          users={activeUsers.map((activeUser) => ({ id: activeUser.id, name: getUserDisplayName(activeUser) }))}
          wholesaleAccounts={wholesaleAccounts}
          worklistItemId={params.worklistItemId}
        />
      </div></div>
    </>
  );
}
