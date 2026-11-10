import { getGithubActionsDispatchConfig, type GithubWorkflowDispatchResult } from '../githubActionsDispatch';
import { ECHO_ORGANIZATION_ID } from '../echoAccess';

export const PRODUCTION_FORECAST_REFRESH_WORKFLOW = 'production-forecast-refresh.yml';
export const productionForecastRefreshRequestId = /^[a-z0-9][a-z0-9_-]{7,99}$(?![\s\S])/i;
export type ForecastRefreshEnvironment = 'test' | 'production';
type DispatchCode = 'DISPATCH_NOT_CONFIGURED' | 'DISPATCH_TARGET_UNSAFE' | 'DISPATCH_REJECTED' | 'DISPATCH_UNAVAILABLE' | 'INVALID_REFRESH_REQUEST';

export class ProductionForecastDispatchError extends Error {
  constructor(readonly code: DispatchCode) {
    super(code === 'DISPATCH_NOT_CONFIGURED' ? 'Production Forecasting refresh is not configured.' : code === 'INVALID_REFRESH_REQUEST' ? 'The forecasting refresh request is invalid.' : 'Production Forecasting refresh could not be queued.');
    this.name = 'ProductionForecastDispatchError';
  }
}

export function productionForecastRefreshTarget(environment: string) {
  if (environment === 'test') return { environment, repository: 'echospirits/neat-tst', ref: 'tst' } as const;
  if (environment === 'production') return { environment, repository: 'echospirits/ohlq-field-crm', ref: 'main' } as const;
  throw new ProductionForecastDispatchError('DISPATCH_TARGET_UNSAFE');
}

/** Reuse the existing dispatch credential without inheriting the broad import
 * workflow override or permitting a cross-environment repository/ref. */
export function getProductionForecastRefreshDispatchConfig() {
  let configured: ReturnType<typeof getGithubActionsDispatchConfig>;
  try { configured = getGithubActionsDispatchConfig(); }
  catch { throw new ProductionForecastDispatchError('DISPATCH_TARGET_UNSAFE'); }
  if (!configured) return null;
  const target = productionForecastRefreshTarget(configured.deploymentEnvironment);
  const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim();
  if (configured.repository !== target.repository || configured.ref !== target.ref || branch && branch !== target.ref) throw new ProductionForecastDispatchError('DISPATCH_TARGET_UNSAFE');
  return { ...configured, workflowId: PRODUCTION_FORECAST_REFRESH_WORKFLOW };
}

export async function dispatchProductionForecastRefresh({ organizationId, requestId }: { organizationId: string; requestId: string }): Promise<GithubWorkflowDispatchResult> {
  if (organizationId !== ECHO_ORGANIZATION_ID || !productionForecastRefreshRequestId.test(requestId)) throw new ProductionForecastDispatchError('INVALID_REFRESH_REQUEST');
  const config = getProductionForecastRefreshDispatchConfig();
  if (!config) throw new ProductionForecastDispatchError('DISPATCH_NOT_CONFIGURED');
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${config.repository}/actions/workflows/${PRODUCTION_FORECAST_REFRESH_WORKFLOW}/dispatches`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ ref: config.ref, inputs: { organizationId, requestId } }),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'User-Agent': 'ohlq-field-crm', 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch { throw new ProductionForecastDispatchError('DISPATCH_UNAVAILABLE'); }
  // Never copy provider response text, request credentials or an unsafe URL into
  // status records, UI errors or logs. The worker must still claim the DB row.
  if (!response.ok) throw new ProductionForecastDispatchError('DISPATCH_REJECTED');
  return { repository: config.repository, ref: config.ref, workflowId: config.workflowId };
}
