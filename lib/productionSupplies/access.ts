import { notFound } from 'next/navigation';
import { requireUser } from '../auth';
import { requireFeatureForUser } from '../organizations';
import { hasSupplyAccess, readSupplySettings } from './config';
export { hasSupplyAccess } from './config';

export async function requireSupplyActor(manage = false) {
  const user = await requireUser();
  const context = await requireFeatureForUser(user, 'PRODUCTION_SUPPLIES');
  const settings = readSupplySettings(context.organization.crmPreferences);
  if (context.isSupportView || !hasSupplyAccess(user, settings, manage)) notFound();
  return { actor: { organizationId: context.organizationId, userId: user.id }, user, context, canManage: hasSupplyAccess(user, settings, true) };
}

// Mailbox owners may connect without receiving access to the shared dashboard.
export async function requireSupplyMailboxOwner() {
  const user = await requireUser();
  const context = await requireFeatureForUser(user, 'PRODUCTION_SUPPLIES');
  if (context.isSupportView) notFound();
  return { user, context };
}
