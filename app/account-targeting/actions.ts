'use server';

import { SalesAccountType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { scheduleTargetedAgencyResearch } from '../../lib/scheduleTargetedAgencyResearch';
import { requireUser } from '../../lib/auth';
import { setAccountTargeting } from '../../lib/accountTargeting';
import { requireOrganizationContext } from '../../lib/organizations';
import { prisma } from '../../lib/prisma';

const safeReturnTo = (value: FormDataEntryValue | null) => {
  const path = String(value ?? '');
  return path.startsWith('/') && !path.startsWith('//') ? path : '/';
};

export async function updateAccountTargeting(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const accountType = String(formData.get('accountType')) === SalesAccountType.AGENCY ? SalesAccountType.AGENCY : SalesAccountType.WHOLESALE;
  const externalAccountId = String(formData.get('externalAccountId') ?? '');
  const isTargeting = formData.get('isTargeting') === 'true';
  const returnTo = safeReturnTo(formData.get('returnTo'));
  if (!externalAccountId) redirect(`${returnTo}?targetStatus=invalid`);
  const targeting = await prisma.$transaction((tx) => setAccountTargeting({ accountType, changedByUserId: user.id, db: tx, externalAccountId, isTargeting, organizationId }));
  if (targeting.changed && targeting.isTargeting && accountType === SalesAccountType.AGENCY) {
    scheduleTargetedAgencyResearch({ agencyId: externalAccountId, organizationId });
  }
  for (const path of [returnTo, '/agencies', '/wholesale', '/alerts', '/my-week', '/pipeline', '/opportunities', '/agency-focus']) revalidatePath(path);
  redirect(`${returnTo}?targetStatus=${isTargeting ? 'targeted' : 'stopped'}`);
}
