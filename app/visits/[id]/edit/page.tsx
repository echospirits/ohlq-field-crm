export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { notFound } from 'next/navigation';
import { buildPageMetadata } from '../../../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { formatTimeMinutesInput } from '../../../../lib/dateTime';
import {
  getAgenciesForVisitPicker,
  getAgencyVisitPickerOptionById,
  getWholesaleAccountsForVisitPicker,
  getWholesaleVisitPickerOptionById,
  sortVisitPickerOptions,
} from '../../../../lib/visitPickerOptions';
import { normalizeFollowUpMode } from '../../../../lib/visitWorkflow';
import { PageHeader } from '../../../components/PageChrome';
import { LogVisitForm } from '../../LogVisitForm';
import { updateVisit } from '../../actions';

export const metadata = buildPageMetadata('Edit Visit');

export default async function EditVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  const visit = await prisma.loggedVisit.findUnique({ where: { id } });
  if (!visit) notFound();

  const [agencyOptions, wholesaleOptions, contacts, activeUsers] = await Promise.all([
    getAgenciesForVisitPicker(),
    getWholesaleAccountsForVisitPicker(),
    prisma.locationContact.findMany({
      orderBy: { name: 'asc' },
      take: 1000,
      select: { id: true, name: true, role: true, phone: true, email: true, agencyId: true, wholesaleAccountId: true },
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { not: 'TASTER' } },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, firstName: true, lastName: true, name: true },
    }),
  ]);
  const [selectedAgency, selectedWholesale] = await Promise.all([
    visit.agencyId && !agencyOptions.some((agency) => agency.id === visit.agencyId)
      ? getAgencyVisitPickerOptionById({ id: visit.agencyId })
      : null,
    visit.wholesaleAccountId && !wholesaleOptions.some((account) => account.id === visit.wholesaleAccountId)
      ? getWholesaleVisitPickerOptionById({ id: visit.wholesaleAccountId })
      : null,
  ]);
  const agencies = sortVisitPickerOptions(selectedAgency ? [selectedAgency, ...agencyOptions] : agencyOptions);
  const wholesaleAccounts = sortVisitPickerOptions(selectedWholesale ? [selectedWholesale, ...wholesaleOptions] : wholesaleOptions);
  const locationName =
    visit.locationType === 'agency'
      ? agencies.find((agency) => agency.id === visit.agencyId)?.name
      : wholesaleAccounts.find((account) => account.id === visit.wholesaleAccountId)?.name;
  const action = updateVisit.bind(null, visit.id);

  return (
    <>
      <PageHeader
        description="Update the useful details without creating another visit or duplicate follow-up task. Existing photos stay attached."
        eyebrow="Field activity"
        title="Edit Visit"
      />
      <div className="workflow-shell"><div className="card">
        <LogVisitForm
          action={action}
          actorName={getUserDisplayName(user)}
          currentUserId={user.id}
          agencies={agencies}
          contacts={contacts}
          initialValues={{
            agencyId: visit.agencyId,
            contactId: visit.contactId,
            followUpDate: visit.followUpDate?.toISOString().slice(0, 10),
            followUpMode: normalizeFollowUpMode(visit.followUpMode),
            followUpTime: formatTimeMinutesInput(visit.followUpTimeMinutes),
            followUpAssignedToUserId: visit.followUpAssignedToUserId ?? user.id,
            locationLocked: true,
            locationName,
            locationType: visit.locationType === 'agency' ? 'agency' : 'wholesale',
            nextStep: visit.nextStep,
            outcomeCodes: visit.outcomeCodes,
            outcomes: visit.outcomes,
            summary: visit.summary,
            wholesaleAccountId: visit.wholesaleAccountId,
          }}
          mode="edit"
          submitLabel="Save changes"
          users={activeUsers.map((activeUser) => ({ id: activeUser.id, name: getUserDisplayName(activeUser) }))}
          wholesaleAccounts={wholesaleAccounts}
        />
      </div></div>
    </>
  );
}
