/** Client-safe request history. Source publication/retrieval timestamps remain
 * on their existing source observations, independent of this job lifecycle. */
export type ForecastRefreshStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'TIMED_OUT';
export type ForecastRefreshStage = 'QUEUED' | 'BAILMENT' | 'GUIDANCE' | 'FORECAST' | 'OPERATIONS' | 'COMPLETE';
export type ForecastRefreshJob = {
  id: string; status: ForecastRefreshStatus; stage: string | null; message: string;
  requestedAt: string; startedAt: string | null; completedAt: string | null; expiresAt: string | null;
};
export type ForecastRefreshState = {
  configured: boolean; unavailableReason: string | null; job: ForecastRefreshJob | null; lastSuccessfulAt: string | null;
};
export type ForecastRefreshActionResult = { ok: boolean; state: ForecastRefreshState; error?: string };
export const unavailableForecastRefreshState = (): ForecastRefreshState => ({ configured: false, unavailableReason: 'Refresh status is temporarily unavailable. Reload the page to try again.', job: null, lastSuccessfulAt: null });
