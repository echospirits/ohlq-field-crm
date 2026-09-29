export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { SubmitButton } from '../../components/SubmitButton';
import { AccountResearchJobStatus, AccountResearchPilotStatus } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requirePlatformAdmin } from '../../../lib/auth';
import { ACCOUNT_RESEARCH_AUTOMATIC_DAILY_BUDGET_MICROS, ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT, ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS, ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS, ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE, formatUsdMicros } from '../../../lib/accountResearchPilot';
import { getAutomaticAccountResearchStatus } from '../../../lib/accountResearchAutomation';
import { getAccountResearchAutomationAvailability, getAccountResearchPilotAvailability } from '../../../lib/accountResearchOpenAI';
import { ACCOUNT_RESEARCH_ACTIONABLE_REVIEW_PREFIX, accountResearchFailureReason, isActionableAccountResearchFailure, isUnsuccessfulAccountResearchAttempt } from '../../../lib/accountResearchFailures';
import { hasResearchIdentityChanged } from '../../../lib/accountResearchQueue';
import { deriveSettledPilotStatus, getLatestAccountResearchPilot } from '../../../lib/accountResearchPilotService';
import { formatEasternDateTime } from '../../../lib/dateTime';
import { prisma } from '../../../lib/prisma';
import { requireFeatureForUser, requireOrganizationContext } from '../../../lib/organizations';
import { PageHeader, SectionHeading } from '../../components/PageChrome';
import { LiveFilterForm } from '../../components/LiveFilterForm';
import { checkAccountResearchPilot, continueAccountResearchPilot, startAccountResearchPilot, uploadAccountResearchCsv } from './actions';
import { AgencyHoursResearchQueue } from './AgencyHoursResearchQueue';
import { readOperatingHoursSchedule } from '../../../lib/operatingHours';

export const metadata = buildPageMetadata('Account Research');

type PageParams = {
  status?: string; rows?: string; imported?: string; errors?: string; detail?: string; submitted?: string;
  failed?: string; remaining?: string; checked?: string; completed?: string; pending?: string;
  applied?: string; rejected?: string; historyPage?: string; view?: string; q?: string; hoursPage?: string;
};

const RESEARCH_HISTORY_PAGE_SIZE = 100;
const AGENCY_HOURS_QUEUE_PAGE_SIZE = 25;

const statusMessage = (params: PageParams) => {
  if (params.status === 'dry-run') return `Dry run passed for ${params.rows ?? '0'} rows. Re-upload the same file and choose Import research.`;
  if (params.status === 'completed') return `${params.imported ?? params.rows ?? '0'} accounts updated and opportunity scores recalculated.`;
  if (params.status === 'failed') return `Import blocked${params.errors ? ` with ${params.errors} validation error(s)` : ''}. Nothing was changed.`;
  if (params.status === 'missing-file') return 'Choose a research CSV before continuing.';
  if (params.status === 'invalid-file') return 'Upload a .csv file generated from the research queue.';
  if (params.status === 'pilot-started') return `Test run started. ${params.submitted ?? '0'} account research jobs were submitted in the background.`;
  if (params.status === 'pilot-continued') return `The next wave of ${params.submitted ?? '0'} account research jobs was submitted.`;
  if (params.status === 'pilot-paused') return `Test run paused after ${params.submitted ?? '0'} submissions and ${params.failed ?? '0'} unsuccessful attempt(s). ${params.remaining ?? '0'} queued accounts were not sent.`;
  if (params.status === 'pilot-checked') return `Checked ${params.checked ?? '0'} jobs: ${params.applied ?? '0'} automatically applied, ${params.rejected ?? '0'} declined by validation, ${params.pending ?? '0'} still running, and ${params.failed ?? '0'} unsuccessful.`;
  if (params.status === 'pilot-approved') return 'Research approved, saved to the account, and its opportunity score recalculated.';
  if (params.status === 'pilot-rejected') return 'Research rejected. No account research or opportunity score was changed.';
  if (params.status === 'pilot-failed') return 'The test run action could not be completed. No unvalidated research was applied.';
  return null;
};

const jobStatusLabel = (job: { status: AccountResearchJobStatus; error?: string | null; reviewNote?: string | null }) => {
  if (isActionableAccountResearchFailure(job)) return 'needs correction';
  if (isUnsuccessfulAccountResearchAttempt(job)) return 'unsuccessful';
  return job.status.replaceAll('_', ' ').toLowerCase();
};
const friendlyPilotError = (errors: Array<string | null>) => {
  const error = errors.find(Boolean) ?? '';
  if (/no credits remaining|insufficient_quota|billing quota|run out of credits/i.test(error)) {
    return 'OpenAI API credits were unavailable when this test ran. No research was applied. After adding credits, start a new test run below.';
  }
  if (/rate.limit|requests.per.minute|tokens.per.minute/i.test(error)) {
    return 'OpenAI temporarily rate-limited this test run. No incomplete result was applied. Start a new test run when capacity is available.';
  }
  if (/401|invalid.api.key|authentication/i.test(error)) {
    return 'OpenAI could not authenticate the API key. No research was applied. Correct the key before starting a new test run.';
  }
  return 'One or more research attempts were unsuccessful. No incomplete result was applied. Review the job ledger for details, then start a new test run when the issue is resolved.';
};

export default async function AccountResearchPage({ searchParams }: { searchParams?: Promise<PageParams> }) {
  const user = await requirePlatformAdmin();
  const { organizationId } = await requireOrganizationContext(user);
  await requireFeatureForUser(user, 'ADVANCED_INTELLIGENCE');
  const params = (await searchParams) ?? {};
  const view = params.view === 'agencies' ? 'agencies' : 'wholesale';
  const requestedHistoryPage = Number.parseInt(params.historyPage ?? '1', 10);
  const historyPage = Number.isFinite(requestedHistoryPage) && requestedHistoryPage > 0 ? requestedHistoryPage : 1;
  const requestedAgencyHoursPage = Number.parseInt(params.hoursPage ?? '1', 10);
  const agencyHoursPage = Number.isFinite(requestedAgencyHoursPage) && requestedAgencyHoursPage > 0 ? requestedAgencyHoursPage : 1;
  // Public account research is shared reference data, so Platform Admin history
  // must include researched accounts even before a tenant opportunity exists.
  const researchWhere = { lastRefreshedAt: { not: null as null } };
  const [automaticStatus, latestResearch, completedCount, pilot, researchHistoryCount, researchHistory, actionableFailureAttempts, agencyRows] = await Promise.all([
    getAutomaticAccountResearchStatus(),
    prisma.targetPublicResearch.findFirst({ where: researchWhere, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.targetPublicResearch.count({ where: { refreshStatus: 'COMPLETE' } }),
    getLatestAccountResearchPilot({ organizationId }),
    prisma.targetPublicResearch.count({ where: researchWhere }),
    prisma.targetPublicResearch.findMany({
      where: researchWhere,
      orderBy: [{ updatedAt: 'desc' }, { wholesaleAccount: { name: 'asc' } }],
      skip: (historyPage - 1) * RESEARCH_HISTORY_PAGE_SIZE,
      take: RESEARCH_HISTORY_PAGE_SIZE,
      select: {
        updatedAt: true,
        researchResponseId: true,
        researcher: true,
        wholesaleAccount: { select: {
          id: true,
          name: true,
          licenseeId: true,
          city: true,
          accountResearchJobs: {
            where: { status: AccountResearchJobStatus.APPROVED },
            orderBy: { reviewedAt: 'desc' },
            take: 1,
            select: { responseId: true, estimatedCostMicros: true },
          },
        } },
      },
    }),
    prisma.accountResearchJob.findMany({
      where: {
        status: AccountResearchJobStatus.REJECTED,
        reviewNote: { startsWith: ACCOUNT_RESEARCH_ACTIONABLE_REVIEW_PREFIX },
      },
      orderBy: [{ reviewedAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        status: true,
        error: true,
        reviewNote: true,
        inputSnapshot: true,
        reviewedAt: true,
        completedAt: true,
        updatedAt: true,
        wholesaleAccount: { select: {
          id: true,
          name: true,
          licenseeId: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          targetPublicResearch: { select: { lastRefreshedAt: true } },
        } },
      },
    }),
    view === 'agencies' ? prisma.agency.findMany({
      orderBy: { agencyId: 'asc' },
      select: { id: true, agencyId: true, name: true, address: true, city: true, state: true, zip: true, businessHours: true },
    }) : Promise.resolve([]),
  ]);
  const availability = getAccountResearchPilotAvailability();
  const automationAvailability = getAccountResearchAutomationAvailability();
  const message = statusMessage(params);
  const counts = new Map<AccountResearchJobStatus, number>();
  for (const job of pilot?.jobs ?? []) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  const reviewJobs = pilot?.jobs.filter((job) => job.status === AccountResearchJobStatus.NEEDS_REVIEW) ?? [];
  const queuedJobs = counts.get(AccountResearchJobStatus.QUEUED) ?? 0;
  const runningJobs = (counts.get(AccountResearchJobStatus.SUBMITTED) ?? 0) + (counts.get(AccountResearchJobStatus.RUNNING) ?? 0);
  const actionablePilotFailures = pilot?.jobs.filter(isActionableAccountResearchFailure) ?? [];
  const unsuccessfulJobs = pilot?.jobs.filter(isUnsuccessfulAccountResearchAttempt) ?? [];
  const failedJobs = actionablePilotFailures.length;
  const unresolvedFailureMap = new Map<string, typeof actionableFailureAttempts[number]>();
  for (const attempt of actionableFailureAttempts) {
    const failedAt = attempt.reviewedAt ?? attempt.completedAt ?? attempt.updatedAt;
    const refreshedAt = attempt.wholesaleAccount.targetPublicResearch?.lastRefreshedAt;
    if (refreshedAt && refreshedAt > failedAt) continue;
    if (hasResearchIdentityChanged(attempt.wholesaleAccount, attempt.inputSnapshot)) continue;
    if (!unresolvedFailureMap.has(attempt.wholesaleAccount.id)) unresolvedFailureMap.set(attempt.wholesaleAccount.id, attempt);
  }
  const unresolvedFailures = [...unresolvedFailureMap.values()];
  const settledStatus = pilot ? deriveSettledPilotStatus(Object.fromEntries(counts)) : null;
  const displayedPilotStatus = settledStatus ?? pilot?.status;
  const displayedPilotStatusLabel = displayedPilotStatus === AccountResearchPilotStatus.FAILED && unsuccessfulJobs.length > 0 && failedJobs === 0
    ? 'unsuccessful'
    : displayedPilotStatus?.replaceAll('_', ' ').toLowerCase();
  const automaticRunStatusLabel = automaticStatus.latestRun?.status === AccountResearchPilotStatus.FAILED
    && automaticStatus.unsuccessfulToday > 0
    && automaticStatus.failedToday === 0
    ? 'unsuccessful'
    : automaticStatus.latestRun?.status.replaceAll('_', ' ').toLowerCase();
  const canStartNewPilot = !pilot
    || displayedPilotStatus === AccountResearchPilotStatus.COMPLETE
    || displayedPilotStatus === AccountResearchPilotStatus.FAILED
    || displayedPilotStatus === AccountResearchPilotStatus.CANCELLED;
  const agencyHoursQueue = agencyRows.filter((agency) => !readOperatingHoursSchedule(agency.businessHours));
  const agencySearch = (params.q ?? '').trim().toLocaleLowerCase();
  const matchingAgencyHoursQueue = agencySearch
    ? agencyHoursQueue.filter((agency) => [agency.agencyId, agency.name, agency.address, agency.city, agency.state, agency.zip].some((value) => value?.toLocaleLowerCase().includes(agencySearch)))
    : agencyHoursQueue;
  const visibleAgencyHoursQueue = matchingAgencyHoursQueue.slice((agencyHoursPage - 1) * AGENCY_HOURS_QUEUE_PAGE_SIZE, agencyHoursPage * AGENCY_HOURS_QUEUE_PAGE_SIZE);
  const addressReadyAgencyCount = agencyHoursQueue.filter((agency) => Boolean(agency.address?.trim() && agency.city?.trim() && agency.state?.trim())).length;
  const agencyHoursPageCount = Math.max(1, Math.ceil(matchingAgencyHoursQueue.length / AGENCY_HOURS_QUEUE_PAGE_SIZE));

  return (
    <>
      <PageHeader actions={<Link className="btn secondary" href="/opportunities">View opportunities</Link>} description={view === 'agencies' ? 'Find and verify public operating hours for Ohio Agencies. The queue highlights missing hours; each lookup starts only when you choose Research hours.' : 'Research the accounts where public evidence can materially improve an opportunity decision. Structured findings are applied automatically only after exact-location validation.'} eyebrow="Administration" title="Account Research" />
      {message ? <p className="toast-notice page-status" role="status">{message}</p> : null}
      {params.detail ? <p className="card danger-text research-import-errors">{params.detail}</p> : null}

      <nav aria-label="Account research queues" className="research-queue-tabs">
        <Link aria-current={view === 'wholesale' ? 'page' : undefined} className={view === 'wholesale' ? 'btn' : 'btn secondary'} href="/admin/account-research">Wholesale</Link>
        <Link aria-current={view === 'agencies' ? 'page' : undefined} className={view === 'agencies' ? 'btn' : 'btn secondary'} href="/admin/account-research?view=agencies">Agencies</Link>
      </nav>

      {view === 'agencies' ? <>
        <div className="grid target-import-stats agency-hours-queue-stats">
          <div className="card metric-card"><h3>Hours needed</h3><p className="metric-value">{agencyHoursQueue.length.toLocaleString()}</p><p className="muted">Agencies without a usable weekly schedule</p></div>
          <div className="card metric-card"><h3>Ready to research</h3><p className="metric-value">{addressReadyAgencyCount.toLocaleString()}</p><p className="muted">Have street address, city, and state</p></div>
          <div className="card metric-card"><h3>Need address details</h3><p className="metric-value">{(agencyHoursQueue.length - addressReadyAgencyCount).toLocaleString()}</p><p className="muted">Open an Agency record to complete its location</p></div>
        </div>
        <section className="dashboard-section" id="agency-hours-queue">
          <SectionHeading count={matchingAgencyHoursQueue.length} description="This Agency queue is populated from saved hours, so adding or confirming a schedule removes the account from the list. Research is manual in TST and production; the Agency detail page keeps its direct research shortcut." title="Agency public-hours queue" />
          {!availability.available ? <p className="card muted">Public lookup is unavailable here. You can still open an Agency and enter known hours manually.</p> : null}
          <LiveFilterForm action="/admin/account-research" className="agency-hours-queue-search" label="Search Agency hours queue" role="search">
            <input name="view" type="hidden" value="agencies" />
            <input name="hoursPage" type="hidden" value="1" />
            <label>Search by Agency number, name, address, or city<input autoComplete="off" defaultValue={params.q ?? ''} name="q" placeholder="Agency number, name, address, or city" type="search" /></label>
          </LiveFilterForm>
          <AgencyHoursResearchQueue agencies={visibleAgencyHoursQueue} researchAvailable={availability.available} />
          {matchingAgencyHoursQueue.length > AGENCY_HOURS_QUEUE_PAGE_SIZE ? <nav aria-label="Agency hours queue pages" className="pagination-actions">
            {agencyHoursPage > 1 ? <Link className="btn secondary" href={`/admin/account-research?view=agencies${agencySearch ? `&q=${encodeURIComponent(params.q ?? '')}` : ''}&hoursPage=${agencyHoursPage - 1}#agency-hours-queue`}>Previous agencies</Link> : <span />}
            <span>Page {agencyHoursPage} of {agencyHoursPageCount}</span>
            {agencyHoursPage < agencyHoursPageCount ? <Link className="btn secondary" href={`/admin/account-research?view=agencies${agencySearch ? `&q=${encodeURIComponent(params.q ?? '')}` : ''}&hoursPage=${agencyHoursPage + 1}#agency-hours-queue`}>More agencies</Link> : null}
          </nav> : null}
        </section>
        <section className="dashboard-section">
          <SectionHeading description="Agency sales, inventory, retail opportunity, and market-fit intelligence refresh through OHLQ data imports. Sourced ownership, store format, neighborhood, and demographic context is maintained on Agency records; it is not part of this public-hours lookup." title="Other Agency research" />
          <article className="card research-workflow-card">
            <p className="muted">Targeting an Agency can request a targeted refresh when complete sales and inventory inputs are available. The separate Store Context fields remain team-entered with source and observation date. Public-hours research does not overwrite either workflow.</p>
            <div className="segmented-submit"><Link className="btn secondary" href="/agency-focus">Open Agency Intelligence</Link><Link className="btn secondary" href="/agencies">Browse Agencies</Link></div>
          </article>
        </section>
      </> : <>

      <div className="grid target-import-stats">
        <div className="card metric-card"><h3>Needing intelligence</h3><p className="metric-value">{automaticStatus.queueCount}</p><p className="muted">Prioritized across all tenant activity; oldest routine refreshes come last</p></div>
        <div className="card metric-card"><h3>Accounts researched</h3><p className="metric-value">{completedCount}</p><p className="muted">Completed public research across all accounts</p></div>
        <div className="card metric-card"><h3>Failures to fix</h3><p className="metric-value">{unresolvedFailures.length.toLocaleString()}</p><p className="muted">Account identity or location issues that may need a correction. Operationally unsuccessful attempts return to the research queue.</p></div>
        <div className="card metric-card"><h3>Latest update</h3><p className="metric-value metric-date">{formatEasternDateTime(latestResearch?.updatedAt) || 'Never'}</p></div>
      </div>

      <section className="dashboard-section">
        <SectionHeading description={`Production checks the queue once daily and durably paces requests in ${ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE}-account waves. Each scheduled or manually invoked workflow run submits no more than ${ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT} accounts or reserves more than ${formatUsdMicros(ACCOUNT_RESEARCH_AUTOMATIC_DAILY_BUDGET_MICROS)}. Opportunity scoring continues independently when sales and CRM activity change.`} title="Automatic research" />
        <article className="card research-workflow-card">
          <div className="research-pilot-summary">
            <div><span className={`status-badge ${automationAvailability.available ? '' : 'muted'}`}>{automationAvailability.available ? 'Enabled' : 'Disabled here'}</span><strong>{automaticStatus.queueCount.toLocaleString()} accounts queued</strong><small>{automaticStatus.submittedToday.toLocaleString()} attempts today · {automaticStatus.uniqueAccountsSubmittedToday.toLocaleString()} unique accounts</small></div>
            <div><strong>Priority queue</strong><small>{automaticStatus.byPriority[1] ?? 0} target / unscored · {automaticStatus.byPriority[2] ?? 0} identity changes · {automaticStatus.byPriority[3] ?? 0} recent activity · {automaticStatus.byPriority[4] ?? 0} due soon</small></div>
            <div><strong>{automaticStatus.latestRun ? automaticRunStatusLabel : 'No automatic run yet'}</strong><small>{automaticStatus.approvedToday.toLocaleString()} applied · {automaticStatus.failedToday.toLocaleString()} failed · {automaticStatus.unsuccessfulToday.toLocaleString()} unsuccessful · {automaticStatus.rejectedToday.toLocaleString()} declined today</small>{automaticStatus.latestRun ? <small>{formatUsdMicros(automaticStatus.latestRun.estimatedSpendMicros)} estimated · started {formatEasternDateTime(automaticStatus.latestRun.startedAt)}</small> : <small>The production scheduler will create the first run when enabled.</small>}</div>
          </div>
          {!automationAvailability.available ? <p className="muted">Automatic OpenAI research is intentionally disabled in this environment. Manual test runs remain available.</p> : null}
          <p className="muted">All active wholesale accounts with a complete address can enter the research queue. Priority still favors unscored accounts, identity changes and near-term tenant activity.</p>
        </article>
      </section>

      <section className="dashboard-section">
        <SectionHeading description={`Run a small, manually triggered ${ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS}-account check in either environment. It reserves no more than ${formatUsdMicros(ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS)} before contacting OpenAI.`} title="Manual test run" />
        {!pilot ? (
          <article className="card research-workflow-card">
            <div className="research-pilot-callout">
              <div><strong>{ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS} accounts · {formatUsdMicros(ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS)} hard ceiling</strong><p className="muted">Exact-location results apply automatically. Uncertain matches are declined without changing account intelligence.</p></div>
              <form action={startAccountResearchPilot}><SubmitButton type="submit" disabled={!availability.available}>Start {ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS}-account test</SubmitButton></form>
            </div>
            {!availability.available ? <p className="danger-text">Unavailable: {!availability.enabled ? 'manual research is disabled' : !availability.hasKey ? 'the OpenAI key is missing' : availability.configurationError}.</p> : null}
          </article>
        ) : (
          <article className="card research-workflow-card">
            <div className="research-pilot-summary">
              <div><span className={`status-badge ${displayedPilotStatus === AccountResearchPilotStatus.FAILED ? 'warning' : ''}`}>{displayedPilotStatusLabel}</span><strong>{pilot.maxAccounts} account test</strong><small>Started {formatEasternDateTime(pilot.startedAt)}</small></div>
              <div><strong>{formatUsdMicros(pilot.estimatedSpendMicros)} estimated</strong><small>{formatUsdMicros(pilot.reservedMicros)} still reserved · {formatUsdMicros(pilot.budgetLimitMicros)} ceiling</small></div>
              <div><strong>{runningJobs} running · {reviewJobs.length} awaiting automatic application</strong><small>{queuedJobs} queued · {failedJobs} failed · {unsuccessfulJobs.length} unsuccessful · {counts.get(AccountResearchJobStatus.APPROVED) ?? 0} applied · {Math.max(0, (counts.get(AccountResearchJobStatus.REJECTED) ?? 0) - failedJobs)} declined</small></div>
            </div>
            {unsuccessfulJobs.length > 0 ? <div className="research-pilot-failure" role="status"><strong>{unsuccessfulJobs.length} research attempt{unsuccessfulJobs.length === 1 ? ' was' : 's were'} unsuccessful</strong><p>{friendlyPilotError(unsuccessfulJobs.map((job) => job.error))} These accounts remain eligible for research.</p></div> : null}
            <div className="segmented-submit research-pilot-actions">
              {runningJobs > 0 || reviewJobs.length > 0 ? <form action={checkAccountResearchPilot}><input name="pilotId" type="hidden" value={pilot.id} /><SubmitButton type="submit">Check and apply research</SubmitButton></form> : null}
              {queuedJobs > 0 && runningJobs === 0 && reviewJobs.length === 0 ? <form action={continueAccountResearchPilot}><input name="pilotId" type="hidden" value={pilot.id} /><SubmitButton className="secondary" type="submit">Submit next {Math.min(ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE, queuedJobs)} accounts</SubmitButton></form> : null}
              {canStartNewPilot ? <form action={startAccountResearchPilot}><SubmitButton type="submit" disabled={!availability.available}>Start new {ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS}-account test</SubmitButton></form> : null}
            </div>
            {canStartNewPilot && !availability.available ? <p className="danger-text">A new test run is unavailable: {!availability.enabled ? 'manual research is disabled' : !availability.hasKey ? 'the OpenAI key is missing' : availability.configurationError}.</p> : null}
            <p className="muted">Only one {ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE}-account wave can run at a time. Check and apply the current wave before sending the next. Costs are metered estimates from response tokens and web-search calls. The application never reserves more than {formatUsdMicros(ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS)}; the OpenAI project budget remains the final billing backstop.</p>
          </article>
        )}
      </section>

      <details className="dashboard-section dashboard-details" id="research-failures">
        <summary><span><strong>Failures to fix</strong><small>{unresolvedFailures.length.toLocaleString()} account{unresolvedFailures.length === 1 ? '' : 's'} with a location match that may need correction</small></span><span className="pill">{unresolvedFailures.length.toLocaleString()}</span></summary>
        <div className="dashboard-details-content">
          {unresolvedFailures.length === 0 ? <div className="empty-state"><h3>No account failures need attention</h3><p>API limits, billing interruptions, and other operational issues are marked unsuccessful and returned to the research queue instead.</p></div> : <div className="card research-job-list">{unresolvedFailures.map((attempt) => {
            const failedAt = attempt.reviewedAt ?? attempt.completedAt ?? attempt.updatedAt;
            const snapshot = attempt.inputSnapshot && typeof attempt.inputSnapshot === 'object' ? attempt.inputSnapshot as { address?: string | null; city?: string | null; zip?: string | null } : null;
            return <div key={attempt.id}><span><strong><Link href={`/wholesale/${attempt.wholesaleAccount.id}`}>{attempt.wholesaleAccount.name}</Link></strong><small>{[attempt.wholesaleAccount.city, attempt.wholesaleAccount.licenseeId].filter(Boolean).join(' · ')}</small><small>{accountResearchFailureReason(attempt)}</small>{snapshot ? <small className="muted">Submitted location: {[snapshot.address, snapshot.city, snapshot.zip].filter(Boolean).join(', ')}</small> : null}</span><span><strong>Needs correction</strong><small>{formatEasternDateTime(failedAt)}</small><Link href={`/wholesale/${attempt.wholesaleAccount.id}`}>Open wholesale account</Link></span></div>;
          })}</div>}
        </div>
      </details>

      <details className="dashboard-section dashboard-details" id="research-history">
        <summary><span><strong>Account research history</strong><small>{researchHistoryCount.toLocaleString()} accounts with saved research · collapsed by default</small></span><span className="pill">{researchHistoryCount.toLocaleString()}</span></summary>
        <div className="dashboard-details-content">
        {researchHistory.length === 0 ? <div className="card empty-state"><h3>No completed research yet</h3><p>Completed, validated account research will appear here.</p></div> : <div className="card research-job-list">{researchHistory.map((item) => {
          const latestJob = item.wholesaleAccount.accountResearchJobs[0];
          const cost = latestJob?.responseId === item.researchResponseId ? latestJob.estimatedCostMicros : undefined;
          return <div key={item.wholesaleAccount.id}><span><strong><Link href={`/wholesale/${item.wholesaleAccount.id}`}>{item.wholesaleAccount.name}</Link></strong><small>{[item.wholesaleAccount.city, item.wholesaleAccount.licenseeId].filter(Boolean).join(' · ')}</small></span><span><strong>{formatEasternDateTime(item.updatedAt)}</strong><small>{cost === undefined ? item.researcher ?? 'Imported research' : `${formatUsdMicros(cost)} estimated cost`}</small></span></div>;
        })}</div>}
        {researchHistoryCount > RESEARCH_HISTORY_PAGE_SIZE ? <nav aria-label="Research history pages" className="pagination-actions">
          {historyPage > 1 ? <Link className="btn secondary" href={`/admin/account-research?historyPage=${historyPage - 1}#research-history`}>Newer updates</Link> : <span />}
          <span>Page {historyPage} of {Math.ceil(researchHistoryCount / RESEARCH_HISTORY_PAGE_SIZE)}</span>
          {historyPage * RESEARCH_HISTORY_PAGE_SIZE < researchHistoryCount ? <Link className="btn secondary" href={`/admin/account-research?historyPage=${historyPage + 1}#research-history`}>Older updates</Link> : null}
        </nav> : null}
        {pilot ? <details className="card research-evidence-disclosure research-job-ledger"><summary>View the latest run’s {pilot.jobs.length} jobs, errors, and costs</summary><div className="research-job-list">{pilot.jobs.map((job) => <div key={job.id}><span><strong>#{job.priority} {job.wholesaleAccount.name}</strong><small>{job.reason}</small>{job.error ? <small className="danger-text">{job.error}</small> : null}</span><span><strong>{jobStatusLabel(job)}</strong><small>{formatUsdMicros(job.estimatedCostMicros)} · {job.webSearchCalls} searches</small></span></div>)}</div></details> : null}
        </div>
      </details>

      <section className="dashboard-section">
        <SectionHeading description="Keep the reviewed CSV workflow available for corrections, third-party research, and recovery." title="Manual CSV fallback" />
        <div className="card research-workflow-card">
          <div className="segmented-submit"><a className="btn secondary" href="/api/admin/account-research/export?limit=100">Download next 100 accounts</a><a className="btn secondary" href="/api/admin/account-research/export?limit=200">Download next 200 accounts</a></div>
          <details className="research-evidence-disclosure"><summary>Show the manual ChatGPT research prompt</summary><pre className="research-prompt">{`Research every account in the attached CRM account-research CSV using current public web sources. Return a downloadable CSV with exactly the same columns and exactly one row for every input row.

Keep every identity column unchanged and verify findings against the exact street address, city, and ZIP. Prefer official websites and current menus. Do not guess. Use | between multiple brands and source URLs, YYYY-MM-DD for researched_at, allowed enum values from the CSV workflow, concise notes, and at least one source URL per row.`}</pre></details>
        </div>
        <form action={uploadAccountResearchCsv} encType="multipart/form-data" className="card target-import-form research-workflow-card">
          <label>Completed research CSV<input name="researchFile" type="file" accept=".csv,text/csv" required /></label>
          <div className="segmented-submit"><SubmitButton name="mode" value="dry-run" type="submit">Validate only</SubmitButton><SubmitButton name="mode" value="commit" type="submit">Import research</SubmitButton></div>
          <p className="muted">Imports remain all-or-nothing. A successful reviewed import immediately recalculates affected opportunities.</p>
        </form>
      </section>
      </>}
    </>
  );
}
