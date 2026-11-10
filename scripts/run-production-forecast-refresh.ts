import { validateRuntimeEnvironment } from '../lib/appEnvironment';
import { ECHO_ORGANIZATION_ID } from '../lib/echoAccess';
import { productionForecastRefreshRequestId, productionForecastRefreshTarget } from '../lib/productionForecasting/refreshDispatch';

export type ForecastRefreshRunnerContext = { requestId: string; organizationId: string; workflowRunId: string; repository: string; environment: 'test' | 'production' };

/** GitHub inputs identify an existing request; they never grant organization
 * authority. The domain runner must atomically claim its persisted DB row. */
export function forecastRefreshRunnerContext(env: NodeJS.ProcessEnv): ForecastRefreshRunnerContext {
  const runtime = validateRuntimeEnvironment(env);
  const target = productionForecastRefreshTarget(runtime.appEnvironment);
  const expectedDatabaseTarget = target.environment === 'test' ? 'neon-neat-tst' : 'neon-ohlq-field-crm-prod';
  const requestId = env.PRODUCTION_FORECAST_REFRESH_REQUEST_ID ?? '';
  const organizationId = env.PRODUCTION_FORECAST_REFRESH_ORGANIZATION_ID ?? '';
  const workflowRunId = env.GITHUB_RUN_ID ?? '';
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REPOSITORY !== target.repository || env.GITHUB_REF !== `refs/heads/${target.ref}`
    || env.DATABASE_TARGET_ID !== expectedDatabaseTarget || organizationId !== ECHO_ORGANIZATION_ID || !productionForecastRefreshRequestId.test(requestId)
    || !/^[1-9][0-9]{0,19}$/.test(workflowRunId) || workflowRunId.trim() !== workflowRunId) throw new Error('Forecasting refresh runner target is invalid.');
  return { requestId, organizationId, workflowRunId, repository: target.repository, environment: target.environment };
}

export function forecastRefreshRunnerReceipt(context: ForecastRefreshRunnerContext, result: unknown) {
  const row = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const statuses = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'TIMED_OUT'];
  const status = typeof row.status === 'string' && statuses.includes(row.status) ? row.status : 'FAILED';
  const counts = Object.fromEntries(['importedSources', 'products', 'failedSources', 'inventoryObserved', 'demandObserved', 'unavailableInventory', 'unavailableDemand', 'warnings'].flatMap(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0 ? [[key, row[key]]] : []));
  return { requestId: context.requestId, environment: context.environment, status, ...(typeof row.replayed === 'boolean' ? { replayed: row.replayed } : {}), ...counts };
}

async function main() {
  const context = forecastRefreshRunnerContext(process.env);
  // No application database module or provider is loaded before target checks.
  const { runProductionForecastRefresh } = await import('../lib/productionForecasting/refreshRequests');
  const { prisma } = await import('../lib/prisma');
  try {
    const result = await runProductionForecastRefresh(context);
    const receipt = forecastRefreshRunnerReceipt(context, result);
    console.log(JSON.stringify(receipt));
    if (['PARTIAL', 'FAILED', 'TIMED_OUT'].includes(receipt.status)) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/run-production-forecast-refresh.ts')) main().catch(() => {
  console.error(JSON.stringify({ status: 'FAILED', phase: 'forecasting-refresh-runner' }));
  process.exitCode = 1;
});
