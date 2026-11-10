'use server';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUserSession } from '../../../lib/auth';
import { isAdminRole } from '../../../lib/userAccess';
import { requireProductionForecastContext } from '../../../lib/productionForecasting/access';
import { enqueueForecastRefresh, getForecastRefreshState } from '../../../lib/productionForecasting/refreshRequests';
import { unavailableForecastRefreshState, type ForecastRefreshActionResult } from '../../../lib/productionForecasting/refreshState';

async function authorized(organizationId: string) {
  const { user } = await requireUserSession();
  if (!isAdminRole(user.role) || typeof organizationId !== 'string' || !organizationId.trim()) notFound();
  const context = await requireProductionForecastContext(user, organizationId.trim());
  return { organizationId: context.organization.id, requestedByUserId: user.id };
}

export async function requestForecastRefresh(organizationId: string): Promise<ForecastRefreshActionResult> {
  const context = await authorized(organizationId);
  try {
    const result = await enqueueForecastRefresh(context);
    revalidatePath('/analytics/production');
    return result;
  } catch { return { ok: false, state: unavailableForecastRefreshState(), error: 'Refresh could not be requested. Check progress before trying again.' }; }
}

export async function getForecastRefreshStatus(organizationId: string): Promise<ForecastRefreshActionResult> {
  const context = await authorized(organizationId);
  const state = await getForecastRefreshState(context.organizationId);
  return { ok: state.unavailableReason !== unavailableForecastRefreshState().unavailableReason, state };
}
