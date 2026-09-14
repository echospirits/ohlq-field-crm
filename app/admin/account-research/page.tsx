export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { AccountResearchJobStatus, AccountResearchPilotStatus } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requirePlatformAdmin } from '../../../lib/auth';
import { getAccountResearchQueue, PURSUED_RESEARCH_DAYS, STANDARD_RESEARCH_DAYS } from '../../../lib/accountResearch';
import { formatUsdMicros, parseAccountResearchResult, type LocationValidation } from '../../../lib/accountResearchPilot';
import { getAccountResearchPilotAvailability } from '../../../lib/accountResearchOpenAI';
import { getLatestAccountResearchPilot } from '../../../lib/accountResearchPilotService';
import { formatEasternDateTime } from '../../../lib/dateTime';
import { prisma } from '../../../lib/prisma';
import { requireFeatureForUser, requireOrganizationContext } from '../../../lib/organizations';
import { PageHeader, SectionHeading } from '../../components/PageChrome';
import { checkAccountResearchPilot, continueAccountResearchPilot, reviewAccountResearchJob, startAccountResearchPilot, uploadAccountResearchCsv } from './actions';

export const metadata = buildPageMetadata('Account Research');

type PageParams = {
  status?: string; rows?: string; imported?: string; errors?: string; detail?: string; submitted?: string;
  failed?: string; remaining?: string; checked?: string; completed?: string; pending?: string;
};

const statusMessage = (params: PageParams) => {
  if (params.status === 'dry-run') return `Dry run passed for ${params.rows ?? '0'} rows. Re-upload the same file and choose Import research.`;
  if (params.status === 'completed') return `${params.imported ?? params.rows ?? '0'} accounts updated and opportunity scores recalculated.`;
  if (params.status === 'failed') return `Import blocked${params.errors ? ` with ${params.errors} validation error(s)` : ''}. Nothing was changed.`;
  if (params.status === 'missing-file') return 'Choose a research CSV before continuing.';
  if (params.status === 'invalid-file') return 'Upload a .csv file generated from the research queue.';
  if (params.status === 'pilot-started') return `Pilot started. ${params.submitted ?? '0'} account research jobs were submitted in the background.`;
  if (params.status === 'pilot-continued') return `Pilot continued. ${params.submitted ?? '0'} additional jobs were submitted.`;
  if (params.status === 'pilot-paused') return `Pilot paused after ${params.submitted ?? '0'} submissions and ${params.failed ?? '0'} failure(s). ${params.remaining ?? '0'} queued accounts were not sent.`;
  if (params.status === 'pilot-checked') return `Checked ${params.checked ?? '0'} jobs: ${params.completed ?? '0'} finished, ${params.pending ?? '0'} still running, and ${params.failed ?? '0'} checks need retrying.`;
  if (params.status === 'pilot-approved') return 'Research approved, saved to the account, and its opportunity score recalculated.';
  if (params.status === 'pilot-rejected') return 'Research rejected. No account research or opportunity score was changed.';
  if (params.status === 'pilot-failed') return 'The pilot action could not be completed. No unreviewed research was applied.';
  return null;
};

const safeResult = (value: unknown) => {
  try { return parseAccountResearchResult(value); } catch { return null; }
};
const jobStatusLabel = (status: AccountResearchJobStatus) => status.replaceAll('_', ' ').toLowerCase();

export default async function AccountResearchPage({ searchParams }: { searchParams?: Promise<PageParams> }) {
  const user = await requirePlatformAdmin();
  const { organizationId } = await requireOrganizationContext(user);
  await requireFeatureForUser(user, 'ADVANCED_INTELLIGENCE');
  const params = (await searchParams) ?? {};
  const [dueAccounts, latestResearch, completedCount, pilot] = await Promise.all([
    getAccountResearchQueue({ limit: null, organizationId }),
    prisma.targetPublicResearch.findFirst({ where: { lastRefreshedAt: { not: null }, wholesaleAccount: { opportunities: { some: { organizationId } } } }, orderBy: { lastRefreshedAt: 'desc' }, select: { lastRefreshedAt: true } }),
    prisma.targetPublicResearch.count({ where: { refreshStatus: 'COMPLETE', wholesaleAccount: { opportunities: { some: { organizationId } } } } }),
    getLatestAccountResearchPilot({ organizationId }),
  ]);
  const availability = getAccountResearchPilotAvailability();
  const message = statusMessage(params);
  const counts = new Map<AccountResearchJobStatus, number>();
  for (const job of pilot?.jobs ?? []) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  const reviewJobs = pilot?.jobs.filter((job) => job.status === AccountResearchJobStatus.NEEDS_REVIEW) ?? [];
  const queuedJobs = counts.get(AccountResearchJobStatus.QUEUED) ?? 0;
  const runningJobs = (counts.get(AccountResearchJobStatus.SUBMITTED) ?? 0) + (counts.get(AccountResearchJobStatus.RUNNING) ?? 0);

  return (
    <>
      <PageHeader actions={<Link className="btn secondary" href="/opportunities">View opportunities</Link>} description="Research the accounts where public evidence can materially improve an opportunity decision. Automated findings remain review-only until approved." eyebrow="Administration" title="Account Research" />
      {message ? <p className="toast-notice page-status" role="status">{message}</p> : null}
      {params.detail ? <p className="card danger-text research-import-errors">{params.detail}</p> : null}

      <div className="grid target-import-stats">
        <div className="card metric-card"><h3>Accounts due</h3><p className="metric-value">{dueAccounts.length}</p><p className="muted">Pursued after {PURSUED_RESEARCH_DAYS} days; others after {STANDARD_RESEARCH_DAYS} days</p></div>
        <div className="card metric-card"><h3>Accounts researched</h3><p className="metric-value">{completedCount}</p><p className="muted">Accounts relevant to this tenant</p></div>
        <div className="card metric-card"><h3>Latest refresh</h3><p className="metric-value metric-date">{formatEasternDateTime(latestResearch?.lastRefreshedAt) || 'Never'}</p></div>
      </div>

      <section className="dashboard-section">
        <SectionHeading description="The pilot is manually triggered, test-only, limited to 50 accounts, and reserves no more than $20 before contacting OpenAI." title="Guarded research pilot" />
        {!pilot ? (
          <article className="card research-workflow-card">
            <div className="research-pilot-callout">
              <div><strong>50 accounts · $20 hard application ceiling</strong><p className="muted">Every result enters manual review. Starting the pilot submits paid background research requests.</p></div>
              <form action={startAccountResearchPilot}><button type="submit" disabled={!availability.available}>Start guarded 50-account pilot</button></form>
            </div>
            {!availability.available ? <p className="danger-text">Unavailable: {availability.appEnvironment !== 'test' ? 'automated research is test-only' : !availability.enabled ? 'ACCOUNT_RESEARCH_PILOT_ENABLED is off' : !availability.hasKey ? 'the test OpenAI key is missing' : availability.configurationError}.</p> : null}
          </article>
        ) : (
          <article className="card research-workflow-card">
            <div className="research-pilot-summary">
              <div><span className="status-badge">{pilot.status.replaceAll('_', ' ').toLowerCase()}</span><strong>{pilot.maxAccounts} account pilot</strong><small>Started {formatEasternDateTime(pilot.startedAt)}</small></div>
              <div><strong>{formatUsdMicros(pilot.estimatedSpendMicros)} estimated</strong><small>{formatUsdMicros(pilot.reservedMicros)} still reserved · {formatUsdMicros(pilot.budgetLimitMicros)} ceiling</small></div>
              <div><strong>{runningJobs} running · {reviewJobs.length} awaiting review</strong><small>{queuedJobs} queued · {counts.get(AccountResearchJobStatus.APPROVED) ?? 0} approved · {counts.get(AccountResearchJobStatus.REJECTED) ?? 0} rejected</small></div>
            </div>
            <div className="segmented-submit research-pilot-actions">
              {runningJobs > 0 ? <form action={checkAccountResearchPilot}><input name="pilotId" type="hidden" value={pilot.id} /><button type="submit">Check research results</button></form> : null}
              {pilot.status === AccountResearchPilotStatus.PAUSED && queuedJobs > 0 ? <form action={continueAccountResearchPilot}><input name="pilotId" type="hidden" value={pilot.id} /><button className="secondary" type="submit">Retry queued accounts</button></form> : null}
            </div>
            <p className="muted">Costs are metered estimates from response tokens and web-search calls. The application never reserves more than $20; the OpenAI project budget remains the final billing backstop.</p>
          </article>
        )}
      </section>

      {pilot ? (
        <section className="dashboard-section">
          <SectionHeading description="Approve only evidence matched to the exact physical location. Rejections do not alter the account or its opportunity score." title={`Manual review queue (${reviewJobs.length})`} />
          {reviewJobs.length === 0 ? <div className="card empty-state"><h3>No results awaiting review</h3><p>{runningJobs > 0 ? 'Background research is still running. Use Check research results when you are ready.' : 'This pilot currently has no unreviewed completed results.'}</p></div> : (
            <div className="research-review-list">
              {reviewJobs.map((job) => {
                const result = safeResult(job.result);
                const validation = job.locationValidation as unknown as LocationValidation | null;
                return (
                  <article className="card research-review-card" key={job.id}>
                    <div className="research-review-heading">
                      <div><span className="page-eyebrow">#{job.priority} · {job.tier.toLowerCase()}</span><h3>{job.wholesaleAccount.name}</h3><p>{[job.wholesaleAccount.address, job.wholesaleAccount.city, job.wholesaleAccount.state, job.wholesaleAccount.zip].filter(Boolean).join(', ')}</p></div>
                      <div><span className={`status-badge ${validation?.exact ? 'success' : 'warning'}`}>{validation?.exact ? 'Exact location' : 'Location check failed'}</span><small>{formatUsdMicros(job.estimatedCostMicros)} estimated</small></div>
                    </div>
                    <p className={validation?.exact ? 'muted' : 'danger-text'}>{validation?.explanation ?? 'Location validation unavailable.'}</p>
                    {result ? <div className="research-decision-summary"><p><strong>{result.openStatus}</strong> · {result.cocktailProgram} cocktail program · {result.popularitySignal} popularity</p><p>{result.notes}</p></div> : <p className="danger-text">Structured result unavailable. Reject this item.</p>}
                    <details className="research-evidence-disclosure"><summary>Review evidence and extracted fields</summary>{result ? <div className="research-evidence-content">
                      <dl><div><dt>Website</dt><dd>{result.websiteUrl ? <a href={result.websiteUrl} target="_blank" rel="noreferrer">Open website</a> : 'Unknown'}</dd></div><div><dt>Cocktail menu</dt><dd>{result.cocktailMenuUrl ? <a href={result.cocktailMenuUrl} target="_blank" rel="noreferrer">Open menu</a> : 'Unknown'}</dd></div><div><dt>Patio</dt><dd>{result.patioOutdoor}</dd></div><div><dt>Google</dt><dd>{result.googleRating ?? 'Unknown'}{result.googleReviewCount !== null ? ` · ${result.googleReviewCount.toLocaleString()} reviews` : ''}</dd></div><div><dt>National chain</dt><dd>{result.isNationalChain === null ? 'Unknown' : result.isNationalChain ? 'Yes' : 'No'}</dd></div><div><dt>Confidence</dt><dd>{result.confidence}</dd></div></dl>
                      <ul>{result.evidence.map((item, index) => <li key={`${item.sourceUrl}-${index}`}><strong>{item.field}:</strong> {item.claim} <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source</a>{item.exactLocation ? ' · exact location' : ''}</li>)}</ul>
                    </div> : null}</details>
                    <div className="research-review-actions">
                      <form action={reviewAccountResearchJob}><input name="jobId" type="hidden" value={job.id} /><input name="decision" type="hidden" value="approve" /><button type="submit" disabled={!validation?.exact || !result}>Approve and recalculate</button>{!validation?.exact ? <small>Approval requires every exact-location check.</small> : null}</form>
                      <form action={reviewAccountResearchJob}><input name="jobId" type="hidden" value={job.id} /><input name="decision" type="hidden" value="reject" /><label>Rejection reason<input name="reviewNote" required maxLength={500} placeholder="Wrong location, stale menu, unsupported claim…" /></label><button className="secondary" type="submit">Reject research</button></form>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <details className="card research-evidence-disclosure research-job-ledger"><summary>View all {pilot.jobs.length} pilot jobs and costs</summary><div className="research-job-list">{pilot.jobs.map((job) => <div key={job.id}><span><strong>#{job.priority} {job.wholesaleAccount.name}</strong><small>{job.reason}</small></span><span><strong>{jobStatusLabel(job.status)}</strong><small>{formatUsdMicros(job.estimatedCostMicros)} · {job.webSearchCalls} searches</small></span></div>)}</div></details>
        </section>
      ) : null}

      <section className="dashboard-section">
        <SectionHeading description="Keep the reviewed CSV workflow available for corrections, third-party research, and recovery." title="Manual CSV fallback" />
        <div className="card research-workflow-card">
          <div className="segmented-submit"><a className="btn secondary" href="/api/admin/account-research/export?limit=100">Download next 100 accounts</a><a className="btn secondary" href="/api/admin/account-research/export?limit=200">Download next 200 accounts</a></div>
          <details className="research-evidence-disclosure"><summary>Show the manual ChatGPT research prompt</summary><pre className="research-prompt">{`Research every account in the attached CRM account-research CSV using current public web sources. Return a downloadable CSV with exactly the same columns and exactly one row for every input row.

Keep every identity column unchanged and verify findings against the exact street address, city, and ZIP. Prefer official websites and current menus. Do not guess. Use | between multiple brands and source URLs, YYYY-MM-DD for researched_at, allowed enum values from the CSV workflow, concise notes, and at least one source URL per row.`}</pre></details>
        </div>
        <form action={uploadAccountResearchCsv} encType="multipart/form-data" className="card target-import-form research-workflow-card">
          <label>Completed research CSV<input name="researchFile" type="file" accept=".csv,text/csv" required /></label>
          <div className="segmented-submit"><button name="mode" value="dry-run" type="submit">Validate only</button><button name="mode" value="commit" type="submit">Import research</button></div>
          <p className="muted">Imports remain all-or-nothing. A successful reviewed import immediately recalculates affected opportunities.</p>
        </form>
      </section>
    </>
  );
}
