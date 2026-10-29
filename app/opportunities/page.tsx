export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { requireUser, getUserDisplayName } from '../../lib/auth';
import { requireFeatureForUser } from '../../lib/organizations';
import { prisma } from '../../lib/prisma';
import { buildPageMetadata } from '../../lib/appBrand';
import { evidenceModeLabel, readAssessment } from '../../lib/wholesaleAssessment';
import { opportunityTerritoryAccountWhere, isOpportunityTerritorySlug, OPPORTUNITY_TERRITORIES } from '../../lib/opportunityTerritories';
import { normalizeUsState } from '../../lib/usStates';
import { WholesaleAssessmentSummary } from '../components/WholesaleAssessmentSummary';
import { ContextualActions } from '../components/ContextualActions';
import { ActionForm } from '../components/ActionForm';
import { SubmitButton } from '../components/SubmitButton';
import { OpportunitySearch } from './OpportunitySearch';
import { TargetAccountControl } from '../components/TargetAccountControl';
import { chosenPursuitWhere } from '../../lib/acceptWholesaleAssessment';
import { commercialAccountKey, commercialDiscoveryFilter, commercialDiscoveryAccountWhere, commercialRatingOrder, normalizeCommercialFilter } from '../../lib/commercialOpportunity';
import { acceptAssessment, assessmentFeedback } from './assessmentActions';
import { OPPORTUNITY_INBOX_PAGE_SIZE, opportunityInboxHref, opportunityInboxPageNumber, type OpportunityInboxQuery } from '../../lib/opportunityInboxView';
import '../intelligence-browsing.css';

export const metadata = buildPageMetadata('Restaurant Opportunities');
type Query = OpportunityInboxQuery;
export default async function OpportunityInbox({ searchParams }: { searchParams?: Promise<Query> }) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'WHOLESALE_OPPORTUNITIES');
  const q = (await searchParams) ?? {};
  const search = q.q?.trim(), state = normalizeUsState(q.state);
  const territory = isOpportunityTerritorySlug(q.territory) ? q.territory : undefined;
  const mode = q.mode && Object.hasOwn(evidenceModeLabel, q.mode) ? q.mode : undefined;
  const ratingFilter = normalizeCommercialFilter(q.rating, q.priority === 'high' ? 'high' : search ? 'all' : 'high');
  const suppressed = await prisma.organizationAccountOverlay.findMany({ where: { organizationId, accountType: 'WHOLESALE', OR: [{ opportunitySuppressed: true }, { active: false }] }, select: { externalAccountId: true } });
  const discovery = commercialDiscoveryFilter(ratingFilter);
  const page = opportunityInboxPageNumber(q.page);
  const where: Prisma.WholesaleAccountAssessmentWhereInput = { organizationId, wholesaleAccount: { mergedIntoId: null,
    ...(ratingFilter === 'high' ? commercialDiscoveryAccountWhere(organizationId, suppressed.map(row => row.externalAccountId)) : {}),
    ...(state ? { state: { equals: state, mode: 'insensitive' } } : {}), ...(territory ? opportunityTerritoryAccountWhere(territory) : {}) },
    ...discovery, ...(mode ? { evidenceMode: mode } : {}),
    ...(search ? { AND: [{ OR: [{ title: { contains: search, mode: 'insensitive' } }, { wholesaleAccount: { name: { contains: search, mode: 'insensitive' } } }, { wholesaleAccount: { city: { contains: search, mode: 'insensitive' } } }] }] } : {}) };
  const [rows, count, assignees, lastRun] = await Promise.all([
    prisma.wholesaleAccountAssessment.findMany({ where, orderBy: commercialRatingOrder(q.sort === 'lowest'), skip: (page - 1) * OPPORTUNITY_INBOX_PAGE_SIZE, take: OPPORTUNITY_INBOX_PAGE_SIZE,
      include: { wholesaleAccount: { select: {
        name: true, city: true, state: true,
        opportunities: { where: { organizationId, ...chosenPursuitWhere }, take: 1,
          include: { worklistItems: { where: { status: { in: ['OPEN','IN_PROGRESS'] } }, take: 1 } } },
      } } } }),
    prisma.wholesaleAccountAssessment.count({ where }),
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { notIn: ['TASTER','PLATFORM_ADMIN'] } }, select: { id: true, name: true, email: true } }),
    prisma.wholesaleAssessmentRun.findFirst({ where: { organizationId, fullSweep: true }, orderBy: { startedAt: 'desc' } }),
  ]);
  const href = (change?: Partial<Query>) => opportunityInboxHref(q, change);
  const users = assignees.map(a => ({ id: a.id, name: getUserDisplayName(a) }));
  const targeted = new Set((await prisma.organizationAccountOverlay.findMany({ where: { organizationId, accountType: 'WHOLESALE', externalAccountId: { in: rows.map(r => r.wholesaleAccountId) }, isTargeting: true }, select: { externalAccountId: true } })).map(r => r.externalAccountId));
  const pagination = <nav aria-label="Restaurant opportunity pages" className="intelligence-pagination">
    <span>{count.toLocaleString()} accounts · Page {page} of {Math.max(1, Math.ceil(count / OPPORTUNITY_INBOX_PAGE_SIZE))}</span>
    <div>
      {page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous page</Link> : null}
      {page * OPPORTUNITY_INBOX_PAGE_SIZE < count ? <Link href={href({ page: String(page + 1) })}>Next page</Link> : null}
    </div>
  </nav>;
  return <div className="opportunities-page">
    <header className="page-heading page-header"><div><h1>Restaurant Opportunities</h1><p>Choose accounts to pursue, ordered by commercial fit.</p></div><div className="intelligence-header-links"><Link href="/alerts?view=pursuing">Chosen pursuits</Link>{['ADMIN','PLATFORM_ADMIN'].includes(user.role) ? <Link href="/admin/opportunity-performance">Refresh status</Link> : null}</div></header>
    <OpportunitySearch value={search ?? ''} state={state ?? ''} rating={q.rating} mode={mode} territory={territory} />
    <nav aria-label="Commercial opportunity filters" className="opportunity-filters">{[['high','Ready to pursue · 3–5 stars'],['all','All ratings'],['zero','Zero stars'],['unrated','Unrated']].map(([value,label]) => <Link key={value} aria-current={ratingFilter === value ? 'page' : undefined} href={href({ rating: value, priority: undefined })}>{label}</Link>)}</nav>
    <details className="compact-details intelligence-filters"><summary>Evidence, territory and sorting{mode || territory || q.sort === 'lowest' ? ' · Filtered' : ''}</summary>
      <nav aria-label="Evidence mode" className="opportunity-filters"><Link aria-current={!mode ? 'page' : undefined} href={href({ mode: undefined })}>All evidence modes</Link>{Object.entries(evidenceModeLabel).map(([value,label]) => <Link key={value} aria-current={mode === value ? 'page' : undefined} href={href({ mode: value })}>{label}</Link>)}</nav>
      <nav aria-label="Territory" className="opportunity-filters"><Link aria-current={!territory ? 'page' : undefined} href={href({ territory: undefined })}>All territories</Link>{OPPORTUNITY_TERRITORIES.map(t => <Link key={t.slug} aria-current={territory === t.slug ? 'page' : undefined} href={href({ territory: t.slug })}>{t.shortLabel}</Link>)}</nav>
      <p><Link href={href({ sort: q.sort === 'lowest' ? undefined : 'lowest' })}>{q.sort === 'lowest' ? 'Show highest stars first' : 'Show lowest stars first'}</Link> · Unrated accounts sort last.</p>
    </details>
    {lastRun?.status === 'SOURCE_ERROR' || lastRun?.status === 'PARTIAL_SOURCE' ? <p role="status">The refresh has source limitations. Existing valid ratings are retained where inputs could not be refreshed.</p> : lastRun?.status !== 'COMPLETED' ? <p role="status">The full refresh is {lastRun?.status === 'RUNNING' ? 'in progress' : 'due or incomplete'}. Existing assessments may be stale; check refresh status.</p> : null}
    {pagination}
    <section aria-label="Current recommendations" className="opportunity-results">{rows.map(row => {
      const assessment = readAssessment(row.assessment), accountKey = commercialAccountKey(row.wholesaleAccountId);
      const pursuit = row.wholesaleAccount.opportunities[0];
      const dismissed = Boolean(row.dismissedKey), snoozed = Boolean(row.snoozedUntil && row.snoozedUntil > new Date());
      return <article className="opportunity-row" key={row.id}>
        <div className="opportunity-row-identity"><h2><Link href={`/wholesale/${row.wholesaleAccountId}`}>{row.wholesaleAccount.name}</Link></h2>{targeted.has(row.wholesaleAccountId) ? <strong className="target-account-marker">TARGET ACCOUNT</strong> : null}<p className="muted">{[row.wholesaleAccount.city,row.wholesaleAccount.state].filter(Boolean).join(', ')}</p></div>
        <WholesaleAssessmentSummary compact value={row.assessment} status={row.assessmentStatus} reason={row.assessmentReason} pending={Boolean(row.refreshRequestedAt)} actions={<div className="assessment-actions">
          {pursuit ? <p><strong>Existing pursuit:</strong> {pursuit.title} · {pursuit.status.toLowerCase()}{pursuit.worklistItems[0] ? <> · <Link href={`/alerts?task=${pursuit.worklistItems[0].id}`}>View task</Link></> : null}</p> : null}
          {dismissed || snoozed ? <p role="status">{dismissed ? `Pursuit dismissed: ${row.dismissalReason}` : `Snoozed until ${row.snoozedUntil!.toISOString().slice(0,10)}`}. Current evidence continues to refresh.</p> : null}
          {assessment && assessment.rating !== null && assessment.rating >= 3 && !pursuit && !dismissed && !snoozed && row.state === 'READY' && row.assessmentStatus === 'READY' ? <details className="compact-details pursuit-accept"><summary>Accept and create follow-up</summary><ActionForm action={acceptAssessment}><input type="hidden" name="id" value={row.id}/><input type="hidden" name="candidateKey" value={accountKey}/>{['ADMIN','PLATFORM_ADMIN'].includes(user.role) ? <label>Assign follow-up<select name="assignedToUserId" defaultValue={users.some(u => u.id === user.id) ? user.id : ''}><option value="" disabled>Choose team member</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label> : null}<SubmitButton disabled={Boolean(row.refreshRequestedAt) || !users.length}>Accept and create follow-up</SubmitButton></ActionForm></details> : null}
          <ContextualActions currentUserId={user.id} users={users} existingFollowUpId={pursuit?.worklistItems[0]?.id} context={{ accountName: row.wholesaleAccount.name, wholesaleAccountId: row.wholesaleAccountId, returnTo: href(), reason: assessment?.reasons.join(' '), sourceLabel: row.title, sourceType: 'CURRENT_ASSESSMENT' }} />
          <details className="compact-details intelligence-more-actions"><summary>Targeting and pursuit preferences</summary>
            <TargetAccountControl accountType="WHOLESALE" externalAccountId={row.wholesaleAccountId} isTargeting={targeted.has(row.wholesaleAccountId)} returnTo={href()} />
            <ActionForm action={assessmentFeedback}><input type="hidden" name="id" value={row.id}/><input type="hidden" name="candidateKey" value={accountKey}/><label>Reason<select name="reason">{['Wrong evidence','Low opportunity','Timing','Do not pursue'].map(r => <option key={r}>{r}</option>)}</select></label><SubmitButton name="action" value="dismiss" disabled={!assessment}>Dismiss from discovery</SubmitButton><label>Snooze until<input name="until" type="date"/></label><SubmitButton name="action" value="snooze">Snooze</SubmitButton><SubmitButton name="action" value="clear">Clear feedback</SubmitButton></ActionForm>
          </details>
        </div>} />
      </article>;
    })}</section>
    {!rows.length ? <p role="status">No current assessments match. <Link href="/opportunities?rating=all">Clear filters</Link> or check the refresh status.</p> : null}
    {pagination}
    <details className="compact-details"><summary>Export commercial ratings</summary><p><a href="/api/wholesale/assessments?format=csv">Download first 500 accounts as CSV</a> · The export includes all ratings and explicit assessment states.</p></details>
  </div>;
}
