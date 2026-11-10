import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type ProductionForecastRefreshRequest } from '@prisma/client';
import { prisma } from '../prisma';
import { getAppEnvironment } from '../appEnvironment';
import { ECHO_ORGANIZATION_ID } from '../echoAccess';
import { forecastAccess } from './import';
import { ohioSourceConfiguration } from './sourceConfiguration';
import type { syncProductionSources, ProductionSourceOutcome } from './sourceWorkflow';
import { dispatchProductionForecastRefresh, getProductionForecastRefreshDispatchConfig, productionForecastRefreshRequestId, productionForecastRefreshTarget } from './refreshDispatch';
import { unavailableForecastRefreshState, type ForecastRefreshActionResult, type ForecastRefreshStage, type ForecastRefreshState, type ForecastRefreshStatus } from './refreshState';

type Db = PrismaClient | Prisma.TransactionClient;
export const FORECAST_REFRESH_QUEUED_TIMEOUT_MS = 5 * 60 * 60_000;
export const FORECAST_REFRESH_LEASE_MS = 15 * 60_000;
export const FORECAST_REFRESH_MAX_RUNNING_MS = 90 * 60_000;
const stages: ForecastRefreshStage[] = ['QUEUED', 'BAILMENT', 'GUIDANCE', 'FORECAST', 'OPERATIONS', 'COMPLETE'];
const stageLabels: Record<ForecastRefreshStage, string> = { QUEUED: 'Waiting to start', BAILMENT: 'Downloading outbound case history', GUIDANCE: 'Downloading distribution-center guidance', FORECAST: 'Saving the forecast', OPERATIONS: 'Checking daily warehouse and demand snapshots', COMPLETE: 'Finished' };
const sourceLabels = { BAILMENT_PO_INVOICE: 'outbound case history', DISTRIBUTION_CENTER: 'distribution-center guidance', FORECAST: 'the forecast calculation', OPERATIONS: 'warehouse and demand checks' };
const runSourceWorker: typeof syncProductionSources = async options => {
  const { syncProductionSources } = await import('./sourceWorkflow');
  return syncProductionSources(options);
};
const defaults = { configuration: getProductionForecastRefreshDispatchConfig, dispatch: dispatchProductionForecastRefresh, sources: runSourceWorker, environment: getAppEnvironment };
export type ForecastRefreshServices = typeof defaults;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const active = { in: ['QUEUED', 'RUNNING'] };
const terminal = (status: string) => !['QUEUED', 'RUNNING'].includes(status);
const safeOutcome = (value: ProductionSourceOutcome): ProductionSourceOutcome => ({ configuredOrganizations: value.configuredOrganizations, importedSources: value.importedSources, refreshedForecasts: value.refreshedForecasts, failedSources: value.failedSources.filter(source => Object.hasOwn(sourceLabels, source)) });

function publicMessage(request: ProductionForecastRefreshRequest) {
  if (request.status === 'QUEUED') return 'Refresh requested. It will begin when the current source checks finish.';
  if (request.status === 'RUNNING') return 'Source reports are being downloaded and the forecast is being updated. Existing daily snapshots may be reused.';
  if (request.status === 'SUCCEEDED') return 'Source reports downloaded and forecast saved; existing daily warehouse and demand snapshots retained where current.';
  if (request.status === 'TIMED_OUT') return 'Refresh status timed out. Previously saved data is preserved. You can request another refresh.';
  if (request.failureCode === 'DISPATCH_FAILED') return 'Refresh could not be queued. Check progress, then try again.';
  if (request.failureCode === 'REQUESTER_UNAVAILABLE') return 'Refresh could not start because administrator access changed. An authorized administrator can try again.';
  const result = request.result as Partial<ProductionSourceOutcome> | null;
  const failed = Array.isArray(result?.failedSources) ? result.failedSources.filter((source): source is keyof typeof sourceLabels => typeof source === 'string' && Object.hasOwn(sourceLabels, source)).map(source => sourceLabels[source]) : [];
  if (request.status === 'PARTIAL') return `${failed.length ? `${failed.join(', ')} could not be refreshed.` : 'Some forecasting sources could not be refreshed.'} Completed imports were retained; existing complete data remains available.`;
  return 'Refresh could not finish. Existing complete source data is preserved. Check the source status and try again.';
}

function publicJob(request: ProductionForecastRefreshRequest) {
  const stage = stages.includes(request.stage as ForecastRefreshStage) ? request.stage as ForecastRefreshStage : null;
  return { id: request.id, status: request.status as ForecastRefreshStatus, stage: stage ? stageLabels[stage] : null, message: publicMessage(request), requestedAt: request.requestedAt.toISOString(), startedAt: request.startedAt?.toISOString() ?? null, completedAt: request.completedAt?.toISOString() ?? null, expiresAt: request.expiresAt?.toISOString() ?? null };
}

async function requireRequester(db: Db, organizationId: string, userId: string) {
  const organization = await forecastAccess(db, organizationId);
  if (!organization.enabledStates.includes('OH')) throw new Error('Forecast refresh is unavailable.');
  const requester = await db.user.findFirst({ where: { id: userId, organizationId, isActive: true, role: { in: ['ADMIN', 'PLATFORM_ADMIN'] } }, select: { id: true } });
  if (!requester) throw new Error('Forecast refresh is unavailable.');
  return organization;
}

async function expireRequests(db: Db, organizationId: string, now: Date) {
  await db.productionForecastRefreshRequest.updateMany({ where: { organizationId, activeKey: organizationId, status: active, expiresAt: { lte: now } }, data: { status: 'TIMED_OUT', activeKey: null, leaseToken: null, expiresAt: null, completedAt: now, failureCode: 'REQUEST_TIMEOUT' } });
}

async function availability(db: Db, organizationId: string, services: ForecastRefreshServices) {
  const organization = await forecastAccess(db, organizationId);
  try { if (!services.configuration()) return 'Automatic refresh is unavailable until its background connection is configured.'; }
  catch { return 'Automatic refresh is unavailable until its background connection is configured for this environment.'; }
  const credentials = await db.organizationOhlqCredentials.findUnique({ where: { organizationId }, select: { organizationId: true } });
  if (!credentials) return 'Connect the forecasting source account before refreshing.';
  const configuration = ohioSourceConfiguration(organization.settings);
  if (!organization.enabledStates.includes('OH') || !configuration.historyStart || !configuration.directInvoices) return 'Complete the forecasting source setup before refreshing.';
  return null;
}

async function readState(db: Db, organizationId: string, services: ForecastRefreshServices): Promise<ForecastRefreshState> {
  const [unavailableReason, job, successful] = await Promise.all([
    availability(db, organizationId, services),
    db.productionForecastRefreshRequest.findFirst({ where: { organizationId }, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }] }),
    db.productionForecastRefreshRequest.findFirst({ where: { organizationId, status: 'SUCCEEDED' }, orderBy: { completedAt: 'desc' } }),
  ]);
  return { configured: unavailableReason === null, unavailableReason, job: job ? publicJob(job) : null, lastSuccessfulAt: successful?.completedAt?.toISOString() ?? null };
}

/** Status reads recover expired orphaned requests without changing source facts.
 * The public page can degrade this one status section if its read fails. */
export async function getForecastRefreshState(organizationId: string, db: PrismaClient = prisma, now = new Date(), overrides: Partial<ForecastRefreshServices> = {}): Promise<ForecastRefreshState> {
  try {
    return await db.$transaction(async tx => {
      await forecastAccess(tx, organizationId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`forecast-refresh-request:${organizationId}`}))`;
      await expireRequests(tx, organizationId, now);
      return readState(tx, organizationId, { ...defaults, ...overrides });
    }, { timeout: 30000 });
  } catch { return unavailableForecastRefreshState(); }
}

export async function enqueueForecastRefresh({ organizationId, requestedByUserId, db = prisma, now = new Date(), services: overrides = {} }: { organizationId: string; requestedByUserId: string; db?: PrismaClient; now?: Date; services?: Partial<ForecastRefreshServices> }): Promise<ForecastRefreshActionResult> {
  const services = { ...defaults, ...overrides };
  const queued = await db.$transaction(async tx => {
    await requireRequester(tx, organizationId, requestedByUserId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`forecast-refresh-request:${organizationId}`}))`;
    await expireRequests(tx, organizationId, now);
    const existing = await tx.productionForecastRefreshRequest.findFirst({ where: { organizationId, activeKey: organizationId, status: active } });
    if (existing) return { request: existing, created: false, unavailableReason: null };
    const unavailableReason = await availability(tx, organizationId, services);
    if (unavailableReason) return { request: null, created: false, unavailableReason };
    const request = await tx.productionForecastRefreshRequest.create({ data: { organizationId, requestedByUserId, status: 'QUEUED', stage: 'QUEUED', activeKey: organizationId, requestedAt: now, expiresAt: new Date(now.getTime() + FORECAST_REFRESH_QUEUED_TIMEOUT_MS) } });
    return { request, created: true, unavailableReason: null };
  }, { timeout: 30000 });
  if (queued.unavailableReason) return { ok: false, error: queued.unavailableReason, state: await getForecastRefreshState(organizationId, db, now, services) };
  if (queued.created && queued.request) {
    try { await services.dispatch({ organizationId, requestId: queued.request.id }); }
    catch {
      // A dispatch acknowledgement may race a worker claim. Never overwrite a
      // running job with a queue error, and never copy provider body text.
      await db.productionForecastRefreshRequest.updateMany({ where: { id: queued.request.id, organizationId, status: 'QUEUED', activeKey: organizationId }, data: { status: 'FAILED', activeKey: null, expiresAt: null, leaseToken: null, completedAt: new Date(), failureCode: 'DISPATCH_FAILED' } });
      const state = await getForecastRefreshState(organizationId, db, new Date(), services);
      return state.job?.status === 'RUNNING' ? { ok: true, state } : { ok: false, state, error: 'Refresh could not be queued. Check progress, then try again.' };
    }
  }
  return { ok: true, state: await getForecastRefreshState(organizationId, db, now, services) };
}

/** Fenced heartbeats cannot revive an expired request or extend its absolute
 * running deadline. Only the worker that claimed this row owns its lease. */
export async function heartbeatForecastRefresh({ requestId, organizationId, leaseToken, startedAt, stage, db = prisma, now = new Date() }: { requestId: string; organizationId: string; leaseToken: string; startedAt: Date; stage?: ForecastRefreshStage; db?: PrismaClient; now?: Date }) {
  const deadline = startedAt.getTime() + FORECAST_REFRESH_MAX_RUNNING_MS;
  if (organizationId !== ECHO_ORGANIZATION_ID || now.getTime() >= deadline || stage && !stages.includes(stage)) return false;
  const result = await db.productionForecastRefreshRequest.updateMany({ where: { id: requestId, organizationId, activeKey: organizationId, status: 'RUNNING', leaseToken, startedAt, expiresAt: { gt: now } }, data: { heartbeatAt: now, expiresAt: new Date(Math.min(deadline, now.getTime() + FORECAST_REFRESH_LEASE_MS)), ...(stage ? { stage } : {}) } });
  return result.count === 1;
}

export type ForecastRefreshRunnerContext = { requestId: string; organizationId: string; workflowRunId: string; repository: string; environment: 'test' | 'production' };
export type ForecastRefreshRunnerResult = { requestId: string; status: ForecastRefreshStatus; replayed: boolean; importedSources: number; failedSources: number };
export async function runProductionForecastRefresh(context: ForecastRefreshRunnerContext, { db = prisma, services: overrides = {}, now: clock = () => new Date(), heartbeatIntervalMs = 60000 }: { db?: PrismaClient; services?: Partial<ForecastRefreshServices>; now?: () => Date; heartbeatIntervalMs?: number } = {}): Promise<ForecastRefreshRunnerResult> {
  const services = { ...defaults, ...overrides };
  const target = productionForecastRefreshTarget(context.environment);
  if (context.organizationId !== ECHO_ORGANIZATION_ID || !productionForecastRefreshRequestId.test(context.requestId) || !/^[0-9]{1,30}$(?![\s\S])/.test(context.workflowRunId) || context.repository !== target.repository || services.environment() !== context.environment) throw new Error('Forecast refresh runner target is invalid.');
  const claimed = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`forecast-refresh-request:${context.organizationId}`}))`;
    const now = clock(); await expireRequests(tx, context.organizationId, now);
    const request = await tx.productionForecastRefreshRequest.findFirst({ where: { id: context.requestId, organizationId: context.organizationId } });
    if (!request) throw new Error('Forecast refresh request is unavailable.');
    if (terminal(request.status) || request.status === 'RUNNING') return { request, owned: false };
    try { await requireRequester(tx, context.organizationId, request.requestedByUserId); }
    catch {
      const denied = await tx.productionForecastRefreshRequest.update({ where: { id: request.id }, data: { status: 'FAILED', completedAt: now, activeKey: null, expiresAt: null, leaseToken: null, failureCode: 'REQUESTER_UNAVAILABLE' } });
      return { request: denied, owned: false };
    }
    const running = await tx.productionForecastRefreshRequest.update({ where: { id: request.id }, data: { status: 'RUNNING', stage: 'BAILMENT', startedAt: now, heartbeatAt: now, expiresAt: new Date(now.getTime() + FORECAST_REFRESH_LEASE_MS), leaseToken: randomUUID(), workflowRunId: context.workflowRunId } });
    return { request: running, owned: true };
  }, { timeout: 30000 });
  const receipt = (request: ProductionForecastRefreshRequest, replayed: boolean): ForecastRefreshRunnerResult => {
    const outcome = request.result as Partial<ProductionSourceOutcome> | null;
    return { requestId: request.id, status: request.status as ForecastRefreshStatus, replayed, importedSources: typeof outcome?.importedSources === 'number' ? outcome.importedSources : 0, failedSources: Array.isArray(outcome?.failedSources) ? outcome.failedSources.length : 0 };
  };
  if (!claimed.owned) return receipt(claimed.request, true);
  const request = claimed.request;
  let outcome: ProductionSourceOutcome | null = null, failed = false, leaseLost = false;
  let inFlight = Promise.resolve();
  const renew = async (stage?: ForecastRefreshStage) => {
    if (leaseLost || !await heartbeatForecastRefresh({ requestId: request.id, organizationId: context.organizationId, leaseToken: request.leaseToken!, startedAt: request.startedAt!, stage, db, now: clock() })) { leaseLost = true; throw new Error('Forecast refresh lease is unavailable.'); }
  };
  const timer = heartbeatIntervalMs > 0 ? setInterval(() => { inFlight = inFlight.then(() => renew()).catch(() => { leaseLost = true; }); }, heartbeatIntervalMs) : null;
  timer?.unref();
  try {
    await services.sources({ db, logger: { log: () => undefined, error: () => undefined }, onStage: renew, onResult: result => { outcome = safeOutcome(result); } });
  } catch { failed = true; }
  finally { if (timer) clearInterval(timer); await inFlight; }
  const completedAt = clock();
  const completed = outcome as ProductionSourceOutcome | null;
  const success = !failed && completed?.configuredOrganizations === 1 && completed.importedSources === 2 && completed.refreshedForecasts === 1 && completed.failedSources.length === 0;
  const status: ForecastRefreshStatus = success ? 'SUCCEEDED' : completed && (completed.importedSources > 0 || completed.refreshedForecasts > 0) ? 'PARTIAL' : 'FAILED';
  const saved = await db.productionForecastRefreshRequest.updateMany({ where: { id: request.id, organizationId: context.organizationId, activeKey: context.organizationId, status: 'RUNNING', leaseToken: request.leaseToken, expiresAt: { gt: completedAt } }, data: { status, stage: 'COMPLETE', activeKey: null, leaseToken: null, expiresAt: null, completedAt, failureCode: success ? null : completed?.configuredOrganizations === 0 ? 'NO_CONFIGURED_SOURCES' : 'SOURCE_REFRESH_INCOMPLETE', result: json(completed ?? { configuredOrganizations: 0, importedSources: 0, refreshedForecasts: 0, failedSources: [] }) } });
  if (!saved.count) {
    await db.productionForecastRefreshRequest.updateMany({ where: { id: request.id, organizationId: context.organizationId, activeKey: context.organizationId, status: 'RUNNING', leaseToken: request.leaseToken }, data: { status: 'TIMED_OUT', activeKey: null, leaseToken: null, expiresAt: null, completedAt, failureCode: 'REQUEST_TIMEOUT' } });
  }
  const final = await db.productionForecastRefreshRequest.findFirst({ where: { id: request.id, organizationId: context.organizationId } });
  if (!final) throw new Error('Forecast refresh receipt is unavailable.');
  return receipt(final, !saved.count);
}
